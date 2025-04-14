require('dotenv').config(); // Load environment variables from .env file AT THE TOP
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios'); // For Google Maps API
const app = express();
const port = process.env.PORT || 3000;

// Securely get API key from environment variables
const Maps_API_KEY = process.env.Maps_API_KEY;
if (!Maps_API_KEY) {
    console.error("FATAL ERROR: Maps_API_KEY is not defined in environment variables.");
    process.exit(1); // Exit if the key isn't configured
}

const USER_SEARCH_RADIUS = 5000; // 5 km for regular users
const EMERGENCY_SEARCH_RADIUS = 50000; // 50 km for emergency services (adjust as needed)

app.use(bodyParser.json());
app.use(cors());

// --- In-Memory Storage ---
// WARNING: Data will be lost if the server restarts. Consider a database for persistence.
let accidentAlerts = [];
let nextAlertId = 1; // Use a counter for IDs

// --- Reusable Function to Get Nearby Alerts ---
async function getNearbyAlerts(alertsToFilter, targetLat, targetLon, searchRadius) {
    if (!targetLat || !targetLon || !alertsToFilter || alertsToFilter.length === 0) {
        return []; // No location or alerts to check
    }

    const distanceRequests = alertsToFilter.map(alert => {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${targetLat},${targetLon}&destinations=${alert.location.lat},${alert.location.lon}&units=metric&key=${Maps_API_KEY}`;
        return axios.get(url).catch(err => {
            // Handle individual request errors gracefully (e.g., log and return null/error indicator)
            console.error(`Error fetching distance for alert ${alert.id}:`, err.response ? err.response.data : err.message);
            return null; // Indicate failure for this specific alert
        });
    });

    try {
        const responses = await Promise.all(distanceRequests);
        const nearbyAlerts = alertsToFilter.filter((alert, index) => {
            const response = responses[index];
            // Check if the request for this alert succeeded
            if (!response || response.status !== 200 || !response.data || response.data.status !== 'OK') {
                 console.warn(`Google Maps API Error or invalid response for alert ${alert.id}:`, response ? response.data : 'No Response');
                 return false; // Exclude if API call failed or returned error
            }

            const distanceData = response.data;

            // Check rows and elements validity
            if (!distanceData.rows || distanceData.rows.length === 0 || !distanceData.rows[0].elements || distanceData.rows[0].elements.length === 0) {
                console.warn(`Unexpected Distance Matrix API response structure for alert ${alert.id}.`);
                return false;
             }

            const element = distanceData.rows[0].elements[0];

            if (element.status === "OK") {
                const distance = element.distance.value; // distance in meters
                console.log(`Alert ${alert.id} distance: ${distance}m, Radius: ${searchRadius}m`);
                return distance <= searchRadius;
            } else {
                console.warn(`Distance calculation status not OK for alert ${alert.id}: ${element.status}`);
                return false; // Exclude if distance calculation failed for this pair
            }
        });
        return nearbyAlerts;
    } catch (error) {
        // This catches errors in Promise.all or subsequent processing, less likely now with individual catches
        console.error("Error processing distance responses:", error);
        // Depending on requirements, you might return [] or throw an error
        return []; // Return empty list on major failure
        // OR throw new Error("Failed to process distances");
    }
}


// --- API Endpoints ---

app.post('/accident', (req, res) => {
    const { location, time, severity } = req.body;

    // Basic validation
    if (!location || typeof location.lat !== 'number' || typeof location.lon !== 'number' || !time || !severity) {
        return res.status(400).json({ error: "Missing or invalid required fields (location object with lat/lon, time, severity)" });
    }

    const alert = {
        id: nextAlertId++, // Assign and increment the ID
        location,
        time, // Consider standardizing time format (e.g., ISO 8601)
        severity
    };
    accidentAlerts.push(alert);

    console.log(`New accident reported: ${JSON.stringify(alert)}`);
    // TODO: Consider notifying emergency services proactively here (e.g., via WebSockets or push notifications) instead of relying only on polling.

    res.status(201).json({ success: true, alert });
});

// Endpoint for REGULAR USERS
app.get('/accidents', async (req, res) => {
    const lastId = parseInt(req.query.lastId) || 0;
    const userLat = parseFloat(req.query.lat);
    const userLon = parseFloat(req.query.lon);

    if (isNaN(userLat) || isNaN(userLon)) {
        return res.status(400).json({ error: "Missing or invalid user location (lat, lon query parameters required)" });
    }

    // 1. Filter for new alerts based on ID
    const newAlerts = accidentAlerts.filter(alert => alert.id > lastId);

    // 2. Filter new alerts by distance using the reusable function
    try {
        const nearbyNewAlerts = await getNearbyAlerts(newAlerts, userLat, userLon, USER_SEARCH_RADIUS);
        console.log(`Returning ${nearbyNewAlerts.length} new nearby alerts for user at ${userLat},${userLon}.`);
        res.json(nearbyNewAlerts);
    } catch (error) {
        console.error("Error getting nearby alerts for user:", error);
        res.status(500).json({ error: "Failed to get accident distances" });
    }
});

// --- NEW Endpoint for EMERGENCY SERVICES ---
app.get('/emergency/accidents', async (req, res) => {
    const lastId = parseInt(req.query.lastId) || 0;
    const serviceLat = parseFloat(req.query.lat);
    const serviceLon = parseFloat(req.query.lon);

    if (isNaN(serviceLat) || isNaN(serviceLon)) {
        return res.status(400).json({ error: "Missing or invalid emergency service location (lat, lon query parameters required)" });
    }

     // --- Authentication/Authorization ---
    // IMPORTANT: Add authentication here! You MUST verify that the request
    // is coming from a legitimate emergency service app.
    // This could involve API keys specific to services, tokens, IP whitelisting, etc.
    // Example (conceptual - replace with real auth):
    /*
    const serviceApiKey = req.headers['x-api-key'];
    if (!isValidEmergencyServiceKey(serviceApiKey)) { // Implement isValidEmergencyServiceKey
        return res.status(403).json({ error: "Forbidden: Invalid credentials" });
    }
    */

    // 1. Filter for new alerts based on ID
    const newAlerts = accidentAlerts.filter(alert => alert.id > lastId);

    // 2. Filter new alerts by distance using the reusable function with the LARGER radius
    try {
        const nearbyNewAlerts = await getNearbyAlerts(newAlerts, serviceLat, serviceLon, EMERGENCY_SEARCH_RADIUS);
        console.log(`Returning ${nearbyNewAlerts.length} new nearby alerts for emergency service at ${serviceLat},${serviceLon}.`);
        res.json(nearbyNewAlerts);
    } catch (error) {
        console.error("Error getting nearby alerts for emergency service:", error);
        res.status(500).json({ error: "Failed to get accident distances" });
    }
});


app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
    console.log(`Using User Radius: ${USER_SEARCH_RADIUS}m, Emergency Radius: ${EMERGENCY_SEARCH_RADIUS}m`);
    // Check if API key was actually loaded (it might be undefined if .env is missing/wrong)
    if (!process.env.Maps_API_KEY) {
         console.warn("Warning: Maps_API_KEY is missing from environment. Distance checks will fail.");
    }
});
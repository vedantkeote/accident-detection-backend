const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios'); // For Google Maps API
const app = express();
const port = process.env.PORT || 3000;
require('dotenv').config();

const GOOGLE_MAPS_API_KEY = process.env.Maps_API_KEY;

if (!Maps_API_KEY) {
    console.error("FATAL ERROR: Maps_API_KEY is not defined in environment variables.");
    process.exit(1);
}

app.use(bodyParser.json());
app.use(cors());

let accidentAlerts = [];

app.post('/accident', (req, res) => {
    const { location, time, severity } = req.body;

    if (!location || !time || !severity || !location.lat || !location.lon) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const alert = {
        id: accidentAlerts.length + 1,
        location,
        time,
        severity
    };
    accidentAlerts.push(alert);

    console.log(`New accident reported: ${JSON.stringify(alert)}`);
    res.status(201).json({ success: true, alert });
});

app.get('/accidents', async (req, res) => {
    const lastId = parseInt(req.query.lastId) || 0;
    const userLat = parseFloat(req.query.lat);
    const userLon = parseFloat(req.query.lon);
    const searchRadius = 5000; // 5 km

    if (!userLat || !userLon) {
        return res.status(400).json({ error: "Missing user location" });
    }

    const newAlerts = accidentAlerts.filter(alert => alert.id > lastId);

    const distanceRequests = newAlerts.map(alert => {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${userLat},${userLon}&destinations=${alert.location.lat},${alert.location.lon}&key=${GOOGLE_MAPS_API_KEY}`;
        return axios.get(url);
    });

    try {
        const responses = await Promise.all(distanceRequests);
        const nearbyAlerts = newAlerts.filter((alert, index) => {
            const distanceData = responses[index].data;
            if (distanceData.rows[0].elements[0].status === "OK") {
                const distance = distanceData.rows[0].elements[0].distance.value;
                return distance <= searchRadius;
            }
            return false;
        });

        res.json(nearbyAlerts);
    } catch (error) {
        console.error("Error fetching distances:", error);
        res.status(500).json({ error: "Failed to get accident distances" });
    }
});
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
});

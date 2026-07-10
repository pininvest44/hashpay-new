const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory status store for tracking progress
let jobStatus = {
    isProcessing: false,
    total: 0,
    processed: 0,
    logs: []
};

// Queue worker configuration
const REQUEST_INTERVAL = 2000; // 2 seconds per request = 30 requests per minute max

async function processQueue(phoneNumbers, amount) {
    jobStatus.isProcessing = true;
    jobStatus.total = phoneNumbers.length;
    jobStatus.processed = 0;
    jobStatus.logs = [];

    const apiKey = process.env.API_KEY;
    const channelId = process.env.CHANNEL_ID || '16';
    const apiUrl = 'https://lipaharakaapis.co.ke/api.php?action=api_stk';

    for (let i = 0; i < phoneNumbers.length; i++) {
        const phone = phoneNumbers[i].trim();
        if (!phone) continue;

        try {
            // Format body as application/x-www-form-urlencoded payload
            // Explicitly tailored for Till context (No base reference or description fields included)
            const payload = new URLSearchParams({
                api_key: apiKey,
                phone: phone,
                amount: amount,
                channel_id: channelId
            });

            const response = await axios.post(apiUrl, payload.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            jobStatus.logs.push({
                phone,
                status: 'Success',
                detail: JSON.stringify(response.data)
            });
        } catch (error) {
            let errorDetail = error.message;
            if (error.response && error.response.data) {
                errorDetail = typeof error.response.data === 'object' 
                    ? JSON.stringify(error.response.data) 
                    : error.response.data;
            }
            jobStatus.logs.push({
                phone,
                status: 'Failed',
                detail: errorDetail
            });
        }

        jobStatus.processed++;

        // Enforce rate limiting delay between requests (except for the last item)
        if (i < phoneNumbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL));
        }
    }

    jobStatus.isProcessing = false;
}

// HTTP API Routes
app.post('/api/initiate-bulk', (req, res) => {
    const { phones, amount } = req.body;

    if (!phones || !amount) {
        return res.status(400).json({ error: 'Missing phone numbers or amount' });
    }
    if (jobStatus.isProcessing) {
        return res.status(429).json({ error: 'A bulk processing job is already running' });
    }

    // Clean up inputs and filter unique phone numbers
    const phoneList = [...new Set(phones.split('\n').map(p => p.trim()).filter(p => p.length > 0))];

    if (phoneList.length === 0) {
        return res.status(400).json({ error: 'No valid phone numbers submitted' });
    }

    // Start background worker process immediately
    processQueue(phoneList, amount);

    res.json({ message: 'Bulk job started successfully', total: phoneList.length });
});

app.get('/api/job-status', (req, res) => {
    res.json(jobStatus);
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});

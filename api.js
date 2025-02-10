/**
 * Calls the Backend API with the given API name and payload.
 * @param {string} apiName - The API endpoint name.
 * @param {Object} payloadDict - The payload to send.
 * @returns {Promise<Object>} - The API response as a JSON object.
 */
function callApi(apiName, payloadDict) {
    const url = `https://api.floramis.com/${apiName}/`;

    if (!payloadDict.creds) {
        payloadDict.creds = {
            type: "telegram",
            secret: process.env.API_SECRET
        };
    }

    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadDict),
    })
    .then(response => response.json());
}

module.exports = { callApi };
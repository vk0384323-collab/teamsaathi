const serverless = require('serverless-http');
const { initDatabase } = require('../../database.js');
const app = require('../../server.js');

let isInitialized = false;
let initPromise = null;
const handler = serverless(app);

module.exports.handler = async (event, context) => {
  if (event.path) {
    if (event.path.startsWith('/.netlify/functions/api')) {
      event.path = event.path.replace('/.netlify/functions/api', '/api');
    } else if (event.path.startsWith('/.netlify/functions')) {
      event.path = event.path.replace('/.netlify/functions', '/api');
    }
  }

  try {
    if (!isInitialized) {
      if (!initPromise) {
        initPromise = initDatabase();
      }
      await initPromise;
      isInitialized = true;
    }
    return await handler(event, context);
  } catch (err) {
    console.error('[Netlify Function Error]', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Runtime Error: ' + err.message,
        stack: err.stack
      })
    };
  }
};

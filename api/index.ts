require('dotenv').config();

const express = require('express');
const { Redis } = require('@upstash/redis');
const axios = require('axios'); // To make requests to your own API
const app = express();

// Connect to Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Helper function to process behavior data
const processBehaviorData = (keys) => {
  const labelsAndValues = keys.map((key) => {
    const segments = key.split(":");
    const behaviorName = segments[segments.length - 2];
    const value = parseInt(segments[segments.length - 1], 10);
    return { behaviorName, value };
  });

  const labelSum = {};
  labelsAndValues.forEach(({ behaviorName, value }) => {
    if (behaviorName) {
      labelSum[behaviorName] = (labelSum[behaviorName] || 0) + value;
    }
  });

  return Object.keys(labelSum).map((behaviorName) => ({
    name: behaviorName,
    value: labelSum[behaviorName],
  }));
};

// API endpoint to get behaviors by name + realm
app.get('/behaviors/:name/:realm', async (req, res) => {
  console.log('GET /behaviors/:name/:realm');

  const name = req.params.name;
  const realm = req.params.realm;

  try {
    const prefix = `wowbehave:behavior:${name}:${realm}:`;
    const keys = await redis.keys(`${prefix}*`);

    if (!keys || keys.length === 0) {
      console.log('No records found for the given name and realm.');
      return res.status(404).json({
        success: false,
        message: 'No records found for the given name and realm.',
      });
    }

    console.log(`Processing ${keys.length} records...`);
    const processedData = processBehaviorData(keys);

    return res.status(200).json({
      success: true,
      data: processedData,
      message: 'Records retrieved and processed successfully.',
    });
  } catch (error) {
    console.error('Error fetching records from Redis:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// API endpoint to get rejoin rating by name + realm
app.get('/rejoinRating/:name/:realm', async (req, res) => {
  console.log('GET /rejoinRating/:name/:realm');

  const name = req.params.name;
  const realm = req.params.realm;

  try {
    const prefix = `wowbehave:rejoin:${name}:${realm}:`;
    const keys = await redis.keys(`${prefix}*`);

    if (!keys || keys.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No records found for the given name and realm.',
      });
    }

    // Transform each key to remove the first three parts, split by ":"
    const result = keys.map((key) => {
      const parts = key.split(":");
      // Join the remaining parts starting from the fourth element (index 3)
      const newKey = parts.slice(3).join(":");
      return { key: newKey };
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Records retrieved successfully.',
    });
  } catch (error) {
    console.error('Error fetching records from Redis:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// New endpoint to calculate teammate score
app.get('/score/:name/:realm', async (req, res) => {
  console.log('GET /score/:name/:realm');

  const name = req.params.name;
  const realm = req.params.realm;

  try {
    // Fetch behavior data
    const behaviorResponse = await axios.get(`http://localhost:3001/behaviors/${name}/${realm}`);
    const behaviorData = behaviorResponse.data;

    // Fetch rejoin rating data
    const rejoinResponse = await axios.get(`http://localhost:3001/rejoinRating/${name}/${realm}`);
    const rejoinData = rejoinResponse.data;

    // Check for missing data
    if (!behaviorData.success || !rejoinData.success) {
      return res.status(404).json({
        success: false,
        message: 'Behavior or rejoin data not found.',
      });
    }

    // Calculate the score
    const calculateTeammateScore = (behaviorData, rejoinData) => {
      if (!behaviorData?.data || !rejoinData?.data) return 0;

      const categoryScores = { damage: 0, defense: 0, healing: 0, communication: 0 };

      behaviorData.data.forEach(item => {
        const segments = item.name.split(":");
        const behaviorName = segments[segments.length - 1];
        const value = item.value;

        if (categoryScores.hasOwnProperty(behaviorName)) {
          categoryScores[behaviorName] += value;
        }
      });

      const totalCategoryScore =
        (categoryScores.damage + categoryScores.defense + categoryScores.healing + categoryScores.communication) / 4;

      const normalizedCategoryScore = ((totalCategoryScore + 1) / 2) * 100;

      const rejoinScore = rejoinData.data.reduce((sum, item) => (item.key === "yes" ? sum + 1 : sum), 0);
      const rejoinRate = rejoinScore / rejoinData.data.length;

      return normalizedCategoryScore + rejoinRate * 10;
    };

    const score = calculateTeammateScore(behaviorData, rejoinData);

    return res.status(200).json({
      success: true,
      score,
      message: 'Teammate score calculated successfully.',
    });
  } catch (error) {
    console.error('Error calculating teammate score:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

app.listen(3001, () => {
  console.log('Server is running on port 3001');
});

module.exports = app;

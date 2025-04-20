// Constants for emissions calculations
const CO2_PER_TOKEN = {
  // GPT-4 models
  'gpt-4': 0.0046 / 1000, // kg CO2 per token
  'gpt-4o': 0.0046 / 1000, // kg CO2 per token
  'gpt-4.5': 0.0046 / 1000, // kg CO2 per token
  'gpt4': 0.0046 / 1000, // kg CO2 per token
  
  // GPT-3.5 models
  'gpt-3.5': 0.0023 / 1000, // kg CO2 per token
  'gpt-3.5-turbo': 0.0023 / 1000, // kg CO2 per token
  'gpt-o3': 0.0023 / 1000, // kg CO2 per token
  
  // Smaller models
  'gpt-o4-mini': 0.0015 / 1000, // kg CO2 per token
  'gpt-o4-mini-high': 0.0015 / 1000, // kg CO2 per token
  'gpt-4o-mini': 0.0015 / 1000, // kg CO2 per token
  
  // Default fallback
  'default': 0.0023 / 1000 // fallback for unknown models
};

// Response time factor - longer responses consume more energy
const TIME_FACTOR = 0.0001; // kg CO2 per second of processing time

const WATER_PER_TOKEN = 0.5 / 1000; // liters per token
const CO2_PER_KILOMETER = 0.404 / 1.60934; // kg CO2 per kilometer driven (converted from per mile)
const GLASS_VOLUME = 0.25; // liters per glass of water

// Default emissions data structure
const DEFAULT_EMISSIONS_DATA = {
  co2: 0,
  water: 0,
  kilometersDriven: 0, // Store kilometers directly
  glassesOfWater: 0,
  totalQueries: 0,
  responseCount: 0
};

// Total emissions key for all chats
const TOTAL_EMISSIONS_KEY = 'totalEmissionsData';
const DEFAULT_TOTAL_EMISSIONS_DATA = {
  co2: 0,
  water: 0,
  kilometersDriven: 0, // Store kilometers directly
  glassesOfWater: 0,
  totalQueries: 0,
  trackingStartDate: 0 // Timestamp (ms) of first tracking or last reset
};

// Function to get emissions data storage key
function getStorageKey(chatId = 'default-chat') {
  return `emissionsData_${chatId}`;
}

// Initialize emissions data if it doesn't exist for a chat
function initializeEmissionsData(chatId = 'default-chat') {
  const storageKey = getStorageKey(chatId);
  chrome.storage.local.get([storageKey], (result) => {
    if (!result[storageKey]) {
      chrome.storage.local.set({ [storageKey]: { ...DEFAULT_EMISSIONS_DATA } });
    } else {
      // Ensure all properties exist and are numeric
      const updatedData = { ...DEFAULT_EMISSIONS_DATA };
      for (const key in result[storageKey]) {
        if (typeof result[storageKey][key] === 'number' && !isNaN(result[storageKey][key])) {
          updatedData[key] = result[storageKey][key];
        }
      }
      // Ensure responseCount exists
      if (typeof updatedData.responseCount !== 'number') {
        updatedData.responseCount = 0;
      }
      // Ensure kilometersDriven exists and is numeric
      if (typeof updatedData.kilometersDriven !== 'number' || isNaN(updatedData.kilometersDriven)) {
        // If migrating from milesDriven, calculate it once
        if (typeof result[storageKey].milesDriven === 'number') {
            updatedData.kilometersDriven = result[storageKey].milesDriven * 1.60934;
        } else {
            updatedData.kilometersDriven = 0;
        }
      }
      // Remove old milesDriven if present
      delete updatedData.milesDriven;

      chrome.storage.local.set({ [storageKey]: updatedData });
    }
  });
}

// Initialize total emissions data if it doesn't exist
function initializeTotalEmissionsData() {
  chrome.storage.local.get([TOTAL_EMISSIONS_KEY], (result) => {
    if (!result[TOTAL_EMISSIONS_KEY]) {
      // First time setup: set start date
      const initialData = { 
          ...DEFAULT_TOTAL_EMISSIONS_DATA,
          trackingStartDate: Date.now() 
      };
      chrome.storage.local.set({ [TOTAL_EMISSIONS_KEY]: initialData }); 
    } else {
      // Ensure all properties exist and are numeric, including start date
      const updatedData = { ...DEFAULT_TOTAL_EMISSIONS_DATA }; 
      for (const key in result[TOTAL_EMISSIONS_KEY]) {
          if (key === 'trackingStartDate') {
              updatedData[key] = typeof result[TOTAL_EMISSIONS_KEY][key] === 'number' ? result[TOTAL_EMISSIONS_KEY][key] : Date.now();
          } else if (typeof result[TOTAL_EMISSIONS_KEY][key] === 'number' && !isNaN(result[TOTAL_EMISSIONS_KEY][key])) {
              updatedData[key] = result[TOTAL_EMISSIONS_KEY][key];
          }
      }
      // Ensure trackingStartDate is set if somehow missing
      if (!updatedData.trackingStartDate) {
          updatedData.trackingStartDate = Date.now();
      }
      // Migrate from milesDriven if necessary (already handled in previous steps, but keep for safety)
      if (typeof updatedData.kilometersDriven !== 'number' || isNaN(updatedData.kilometersDriven)) {
        if (typeof result[TOTAL_EMISSIONS_KEY].milesDriven === 'number') {
            updatedData.kilometersDriven = result[TOTAL_EMISSIONS_KEY].milesDriven * 1.60934;
        } else {
            updatedData.kilometersDriven = 0;
        }
      }
      delete updatedData.milesDriven;

      // Only set if there were actual changes needed, primarily for adding trackingStartDate
      if (JSON.stringify(updatedData) !== JSON.stringify(result[TOTAL_EMISSIONS_KEY])) {
         chrome.storage.local.set({ [TOTAL_EMISSIONS_KEY]: updatedData });
      }
    }
  });
}

// Initialize default emissions data
initializeEmissionsData();
initializeTotalEmissionsData();

// Get the correct model key
function getModelKey(modelName) {
  // Convert to lowercase for case-insensitive matching
  const lowerModelName = modelName.toLowerCase();
  
  // Direct matching
  if (CO2_PER_TOKEN[lowerModelName]) {
    return lowerModelName;
  }
  
  // Pattern matching
  if (lowerModelName.includes('gpt-4') || lowerModelName.includes('gpt4')) {
    return 'gpt-4';
  }
  
  if (lowerModelName.includes('gpt-3.5') || lowerModelName.includes('gpt3.5')) {
    return 'gpt-3.5';
  }
  
  // Default fallback
  return 'default';
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  // Get the chat ID from the message or use default
  const chatId = message.chatId || 'default-chat';
  const storageKey = getStorageKey(chatId);
  
  if (message.type === 'chatgpt_request') {
    // Handle request message
    console.log('Processing chatgpt_request for chat:', chatId);
    chrome.storage.local.get([storageKey, TOTAL_EMISSIONS_KEY], (result) => {
      console.log('Current emissions data from storage:', result[storageKey]);
      
      // Make sure we have valid emissions data
      const emissionsData = { ...DEFAULT_EMISSIONS_DATA };
      if (result[storageKey]) {
        // Copy only numeric values
        for (const key in result[storageKey]) {
          if (typeof result[storageKey][key] === 'number' && !isNaN(result[storageKey][key])) {
            emissionsData[key] = result[storageKey][key];
          }
        }
      }
      
      // Make sure we have valid total emissions data
      const totalEmissionsData = { ...DEFAULT_TOTAL_EMISSIONS_DATA };
      if (result[TOTAL_EMISSIONS_KEY]) {
        // Copy only numeric values
        for (const key in result[TOTAL_EMISSIONS_KEY]) {
          if (typeof result[TOTAL_EMISSIONS_KEY][key] === 'number' && !isNaN(result[TOTAL_EMISSIONS_KEY][key])) {
            totalEmissionsData[key] = result[TOTAL_EMISSIONS_KEY][key];
          }
        }
      }
      
      // Get model key
      const rawModel = message.model || 'default';
      const modelKey = getModelKey(rawModel);
      console.log('Raw model name:', rawModel);
      console.log('Mapped to model key:', modelKey);
      
      // Get emission factors
      const co2PerToken = CO2_PER_TOKEN[modelKey];
      const waterPerToken = WATER_PER_TOKEN;
      console.log('Emission factors:', { co2PerToken, waterPerToken });
      
      // Calculate emissions for this request
      const tokens = message.outputTokens || 0;
      
      // Include response time in calculation if available
      const responseTime = message.responseTime || 0; // time in seconds
      const timeFactor = responseTime * TIME_FACTOR;
      
      // Calculate CO2: token-based + time-based
      const co2 = (tokens * co2PerToken) + timeFactor;
      const water = tokens * waterPerToken;
      
      console.log('Calculated emissions for this request:', { 
        tokens, 
        responseTime,
        tokenCO2: tokens * co2PerToken,
        timeCO2: timeFactor,
        totalCO2: co2,
        water 
      });
      
      // Update cumulative emissions data for this chat
      emissionsData.co2 += co2;
      emissionsData.water += water;
      emissionsData.kilometersDriven = emissionsData.co2 / CO2_PER_KILOMETER; // Calculate kilometers
      emissionsData.glassesOfWater = emissionsData.water / GLASS_VOLUME; // Recalculate based on new total
      emissionsData.totalQueries += 1; // Increment total queries for this chat
      emissionsData.responseCount += 1; // Increment response count for this chat
      // Remove old milesDriven if present
      delete emissionsData.milesDriven;
      
      // Update total emissions data across all chats
      totalEmissionsData.co2 += co2;
      totalEmissionsData.water += water;
      totalEmissionsData.kilometersDriven = totalEmissionsData.co2 / CO2_PER_KILOMETER; // Calculate kilometers
      totalEmissionsData.glassesOfWater = totalEmissionsData.water / GLASS_VOLUME; // Recalculate based on new total
      totalEmissionsData.totalQueries += 1; // Increment overall total queries
      // Remove old milesDriven if present
      delete totalEmissionsData.milesDriven;
      
      console.log('Updated cumulative emissions data for chat:', emissionsData);
      console.log('Updated total emissions data:', totalEmissionsData);
      
      // Save updated data
      console.log('Saving updated emissions data to storage...');
      chrome.storage.local.set({ 
        [storageKey]: emissionsData,
        [TOTAL_EMISSIONS_KEY]: totalEmissionsData
      }, () => {
        console.log('Emissions data saved successfully');
        sendResponse({ 
          success: true,
          emissionsData: emissionsData,
          totalEmissionsData: totalEmissionsData
        });
      });
    });
    return true; // Keep the message channel open for async response
  }
  
  if (message.type === 'chatgpt_response') {
    // Handle response message
    console.log('Processing chatgpt_response for chat:', chatId);
    chrome.storage.local.get([storageKey, TOTAL_EMISSIONS_KEY], (result) => {
      console.log('Retrieved emissions data for response:', result[storageKey]);
      
      // Ensure we have valid emissions data to return
      const safeData = { ...DEFAULT_EMISSIONS_DATA };
      if (result[storageKey]) {
        // Copy only numeric values
        for (const key in result[storageKey]) {
          if (typeof result[storageKey][key] === 'number' && !isNaN(result[storageKey][key])) {
            safeData[key] = result[storageKey][key];
          }
        }
      }
      
      // Ensure we have valid total emissions data to return
      const totalData = { ...DEFAULT_TOTAL_EMISSIONS_DATA };
      if (result[TOTAL_EMISSIONS_KEY]) {
        // Copy only numeric values
        for (const key in result[TOTAL_EMISSIONS_KEY]) {
          if (typeof result[TOTAL_EMISSIONS_KEY][key] === 'number' && !isNaN(result[TOTAL_EMISSIONS_KEY][key])) {
            totalData[key] = result[TOTAL_EMISSIONS_KEY][key];
          }
        }
      }
      
      sendResponse({
        ...safeData,
        totalEmissionsData: totalData
      });
    });
    return true; // Keep the message channel open for async response
  }
  
  if (message.type === 'get_total_emissions') {
    // Return only the total emissions data
    chrome.storage.local.get([TOTAL_EMISSIONS_KEY], (result) => {
      // Ensure data exists and is valid before sending
      const safeTotalData = { ...DEFAULT_TOTAL_EMISSIONS_DATA }; // Use total default
      if (result[TOTAL_EMISSIONS_KEY]) {
         for (const key in result[TOTAL_EMISSIONS_KEY]) {
            // Ensure trackingStartDate is copied correctly
            if (key === 'trackingStartDate' && typeof result[TOTAL_EMISSIONS_KEY][key] === 'number') {
                 safeTotalData[key] = result[TOTAL_EMISSIONS_KEY][key];
            } else if (typeof result[TOTAL_EMISSIONS_KEY][key] === 'number' && !isNaN(result[TOTAL_EMISSIONS_KEY][key])) {
                 safeTotalData[key] = result[TOTAL_EMISSIONS_KEY][key];
            }
         }
         // Ensure trackingStartDate has a fallback if missing from storage for some reason
         if (!safeTotalData.trackingStartDate) {
            safeTotalData.trackingStartDate = Date.now(); 
         }
      } else {
         // If no data exists at all, initialize with current date
         safeTotalData.trackingStartDate = Date.now();
      }
      sendResponse({
        totalEmissionsData: safeTotalData
      });
    });
    return true; // Keep channel open for async response
  }
  
  // **NEW**: Reset total emissions data
  if (message.type === 'reset_total_emissions') {
    console.log('Resetting total emissions data...');
    const chatIdToReset = message.chatId; // Get chat ID from message
    
    // Reset total data AND update its tracking start date
    const resetTotalData = { 
        ...DEFAULT_TOTAL_EMISSIONS_DATA, 
        trackingStartDate: Date.now() 
    };
    
    // Prepare storage operations
    const operations = { [TOTAL_EMISSIONS_KEY]: resetTotalData };
    
    // Also reset current chat data if a valid chat ID was provided
    if (chatIdToReset && chatIdToReset !== 'unknown-chat' && chatIdToReset !== null) {
        const chatStorageKey = getStorageKey(chatIdToReset);
        // Reset chat data but KEEP its own responseCount/totalQueries logic if separate
        // Or just reset to full default if desired.
        operations[chatStorageKey] = { ...DEFAULT_EMISSIONS_DATA }; 
        console.log(`Also resetting emissions for chat ID: ${chatIdToReset}`);
    } else {
        console.log("No valid chat ID provided, only resetting total emissions.");
    }

    chrome.storage.local.set(operations, () => {
      if (chrome.runtime.lastError) {
        console.error("Error resetting emissions in storage:", chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('Emissions data reset successfully in storage.');
        sendResponse({ success: true });
      }
    });
    return true; // Indicate async response
  }
  
  // Reset emissions data (This seems to be for individual chats - keep or remove?)
  // If keeping, ensure it doesn't conflict with the total reset.
  // Let's comment it out for now to avoid confusion.
  /*
  if (message.type === 'reset_emissions') {
    console.log('Resetting emissions data for chat:', chatId);
    chrome.storage.local.set({ [storageKey]: { ...DEFAULT_EMISSIONS_DATA } }, () => {
      console.log('Emissions data reset successfully');
      sendResponse({ success: true });
    });
    return true;
  }
  */
});

// Log when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('ChatGPT CO2 Tracker extension installed/updated.');
  // Initialize total emissions data on install/update
  initializeTotalEmissionsData();
}); 
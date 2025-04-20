// Function to create total emissions display
function createTotalEmissionsDisplay(data) {
  // Create container for the content itself
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.justifyContent = 'space-between';
  container.style.alignItems = 'center';
  container.style.width = '100%';
  container.style.padding = '8px 16px';
  container.style.boxSizing = 'border-box';
  container.style.fontSize = '0.875rem';
  
  // Background/color/border-color will be applied directly to totalDisplayArea in updateTotal
  
  // Ensure all values exist and are numbers
  const co2 = typeof data.co2 === 'number' ? data.co2 : 0;
  const water = typeof data.water === 'number' ? data.water : 0;
  const totalQueries = typeof data.totalQueries === 'number' ? data.totalQueries : 0;
  const trackingStartDate = typeof data.trackingStartDate === 'number' && data.trackingStartDate > 0 ? data.trackingStartDate : null;

  // Format the date
  let sinceDateString = '';
  if (trackingStartDate) {
    const date = new Date(trackingStartDate);
    sinceDateString = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  // Set innerHTML with a left group and a right button
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;"> 
        <span style="font-weight: 600;">
            Total Footprint 
            ${sinceDateString ? `<span style="font-weight: normal; font-size: 0.7rem; color: #888; margin-left: 5px;">(since ${sinceDateString})</span>` : ''}
        </span>
        <span>${co2.toFixed(2)} kg CO₂</span>
        <span>${water.toFixed(1)} L water</span>
        <span style="color: ${document.documentElement.classList.contains('dark') ? '#aaa' : '#666'};">(${totalQueries} queries)</span>
    </div>
    <button id="reset-total-button" style="padding: 4px 8px; font-size: 0.75rem; border: 1px solid gray; border-radius: 4px; cursor: pointer; background-color: transparent; color: inherit;">Reset</button>
  `;
  
  return container;
}

// Function to find ChatGPT response containers
function findResponseContainers() {
  return document.querySelectorAll('div[data-message-author-role="assistant"]');
}

// Get rough token count from text
function estimateTokens(text) {
  return Math.ceil(text.length / 4); // Simple approximation
}

// Get the current chat ID from the URL
function getChatId() {
  // Try to get from URL path /c/uuid
  const pathMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // Try to get from URL search params ?gizmo=g-xxx
  const searchParams = new URLSearchParams(window.location.search);
  const gizmoId = searchParams.get('gizmo');
  if (gizmoId) {
    // You might want a more specific ID, but gizmo ID can work as a key
    // Combine with pathname if needed for more uniqueness e.g., /g/gizmoId
    return gizmoId;
  }

  // Check if it's the base URL (potentially new chat)
  if (window.location.pathname === '/chat' || window.location.pathname === '/') {
     // Let's rely on the response observer to assign an ID when a response appears
     // or assign a temporary one if needed for immediate actions.
     // Returning null signifies we wait for the actual chat ID.
     // For now, let's use a placeholder if immediate actions needed,
     // but preferably handle this downstream.
     // Consider if 'new-chat' is truly needed or if observing messages is enough.
     // If we MUST have an ID now:
     // return 'new-chat-' + Date.now(); // Less reliable for SPA navigation
     return null; // Indicate no specific chat ID found yet
  }

  // Fallback if none of the above match - less likely but possible
  console.warn("Could not determine chat ID from URL:", window.location.href);
  return 'unknown-chat'; // Or handle as an error state
}

// Function to calculate emissions for a response - THIS SHOULD ONLY RUN FOR NEW RESPONSES
// Ensure this is only called when a *new* response is detected and completed.
function calculateAndStoreEmissions(responseContainer, responseTime = 0) {
  const chatId = getChatId();
  if (!chatId) {
    console.warn("Skipping emission calculation: No valid chat ID.");
    return;
  }

  setTimeout(() => {
    const responseText = responseContainer.textContent.trim();
    const outputTokens = estimateTokens(responseText);
    
    let model = 'default';
    try {
      const statusContainer = responseContainer.parentElement?.parentElement;
      const actionBar = statusContainer?.querySelector('div.flex.justify-start'); 

      if (actionBar) {
        const modelElement = actionBar.querySelector('span.overflow-hidden.text-sm.text-clip.whitespace-nowrap'); 
        
        if (modelElement) {
          const rawText = modelElement.textContent;
          if (rawText) {
            let potentialModel = rawText.trim().toLowerCase();
            if (potentialModel) {
              if (!potentialModel.startsWith('gpt-') && /^[\d.]+[\w\s-]*$/.test(potentialModel)) {
                potentialModel = potentialModel.replace(/\s+/g, '-'); 
                model = `gpt-${potentialModel}`; 
              } else if (potentialModel.startsWith('gpt-')) {
                model = potentialModel;
              }
            }
          }
        } else {
          const modelFromAttribute = responseContainer.getAttribute('data-message-model-slug');
          if (modelFromAttribute && modelFromAttribute !== 'default') {
            model = modelFromAttribute;
          }
        }
      }
    } catch (e) {
      console.error("Error extracting model from response action bar:", e);
    }

    chrome.runtime.sendMessage({
      type: 'chatgpt_request',
      model: model,
      outputTokens: outputTokens,
      responseTime: responseTime,
      chatId: chatId
    }, response => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message to background:", chrome.runtime.lastError);
        return;
      }

      if (response && response.success) {
        if (response.totalEmissionsData) {
          updateTotalEmissionsDisplay(response.totalEmissionsData);
        }
        if (response.emissionsData && chatId) {
          updateChatEmissionsDisplay(chatId, response.emissionsData, responseTime);
        }
      } else {
        console.error('Background script reported failure or missing data:', response);
      }
    });
  }, 150);
}

// Global variables to track the active chat and observers
let activeObservers = [];
let currentChatId = null;
let pageLoaded = false;
let responseObserver = null;
let urlObserver = null;
let intervalId = null; // For periodic checks

// Main initialization function - called on page load and URL changes
function initialize() {
  console.log("Initializing CO2 Tracker for URL:", window.location.href);
  const newChatId = getChatId();
  console.log("Determined Chat ID:", newChatId);

  // If chat ID hasn't changed, do nothing (avoids redundant setup)
  // Allow initialization if currentChatId is null (first load)
  // Allow initialization if newChatId is null (navigating to /chat base URL) - setupResponseMonitoring handles this
  // if (newChatId && currentChatId === newChatId) {
  //   console.log("Chat ID unchanged, skipping re-initialization.");
  //   return;
  // }

  // Cleanup previous observers/timers before setting up new ones
  cleanup();
  
  currentChatId = newChatId; // Update the global chat ID
  
  // Fetch and display total emissions (always do this)
  fetchAndDisplayTotalEmissions();
  
  // Setup monitoring for new responses for the current chat context
  // This observer will handle new messages appearing
  setupResponseMonitoring();
  
  // Fetch and display data for *existing* messages in the current view
  // This handles refresh and navigating back to a chat
  if (currentChatId) { // Only fetch if we have a valid chat ID
      console.log("Fetching existing emissions data for chat:", currentChatId);
    const responseContainers = findResponseContainers();
    responseContainers.forEach(container => {
          // Check if it already has a display (might have been added by streaming)
      if (!container.querySelector('.co2-tracker-display')) {
               fetchEmissionsDataForChat(container, currentChatId); // Pass the specific chat ID
          } else {
              console.log("Display already exists for this container, skipping fetch.");
          }
      });
  } else {
      console.log("No specific chat ID found (e.g., /chat page), waiting for messages or navigation.");
      // Displays for previous messages will be added by setupResponseMonitoring
      // if the user sends a message in this 'new' chat context.
  }

  // Ensure URL change monitoring is active
  setupUrlChangeMonitoring(); // Re-setup observer after cleanup

  // Initialize and populate bottom chat display
  initializeChatDisplayArea();
  updateChatEmissionsDisplay(currentChatId);

  console.log("Initialization complete for chat:", currentChatId);
}

// Clean up all observers
function cleanup() {
  console.log("Cleaning up observers and timers for previous chat:", currentChatId);
  if (responseObserver) {
    responseObserver.disconnect();
    responseObserver = null;
    console.log("Disconnected response observer.");
  }
  // We keep the URL observer running generally, but disconnect specific listeners if needed
  // If urlObserver is used for more than just URL changes (e.g., title), it might need cleanup
  // if (urlObserver) {
  //    urlObserver.disconnect();
  //    urlObserver = null;
  // }
  if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log("Cleared interval timer.");
  }
  // Remove existing total emissions display to prevent duplicates on re-init
  const existingTotalDisplay = document.getElementById('co2-total-emissions');
   if (existingTotalDisplay) {
       // existingTotalDisplay.remove(); // Decide if removal is needed or just update
   }
}

// Setup monitoring for URL changes (more robustly)
function setupUrlChangeMonitoring() {
    // If observer already exists, don't create a new one
    if (urlObserver) return;

    console.log("Setting up URL change monitoring.");
    let lastUrl = window.location.href;

    // Option 1: Use MutationObserver on title (often changes with SPA navigation)
    const titleElement = document.querySelector('head > title');
    if (titleElement) {
        urlObserver = new MutationObserver(() => {
            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
                console.log(`URL change detected (Title Observer): ${lastUrl} -> ${currentUrl}`);
                lastUrl = currentUrl;
                handleUrlChange(); // Call the handler
            }
        });
        urlObserver.observe(titleElement, { childList: true });
    } else {
        console.warn("Could not find title element for URL change monitoring.");
        // Fallback or alternative needed if title doesn't exist/work
    }


    // Option 2: Periodic check (less efficient, but a fallback)
    // Consider removing this if the title observer is reliable
    // intervalId = setInterval(() => {
    //     const currentUrl = window.location.href;
    //     if (currentUrl !== lastUrl) {
    //         console.log(`URL change detected (Interval): ${lastUrl} -> ${currentUrl}`);
    //         lastUrl = currentUrl;
    //         handleUrlChange(); // Call the handler
    //     }
    // }, 1000); // Check every second

    // Option 3: Listen to popstate/hashchange (might work for some navigation)
    // window.addEventListener('popstate', handleUrlChange);
    // window.addEventListener('hashchange', handleUrlChange);
    // Note: These might not cover all SPA navigation types in ChatGPT.
}

// Handler for URL changes
function handleUrlChange() {
  console.log("Handling URL change...");
  // Re-initialize the script for the new page context/chat ID
  // Initialize will handle cleanup and setup for the new ID
    initialize();
}

// Setup MutationObserver to watch for new ChatGPT responses
function setupResponseMonitoring() {
  // If observer already exists, disconnect the old one first
  if (responseObserver) {
    responseObserver.disconnect();
  }
  console.log("Setting up response monitoring.");

  const targetNode = document.body; // Observe the whole body, or a more specific container if identifiable
  if (!targetNode) {
    console.error("Target node for response observer not found!");
    return;
  }

  const config = { childList: true, subtree: true };

  responseObserver = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          // Check if the added node is an element and contains a response container
          if (node.nodeType === 1) { // Check if it's an element node
             // Look for assistant messages within the added node or its children
             const responseContainers = node.matches('div[data-message-author-role="assistant"]')
                ? [node] // The added node itself is the container
                : node.querySelectorAll('div[data-message-author-role="assistant"]'); // Look inside the added node


              responseContainers.forEach(container => {
                 // Check if we haven't processed this container yet (e.g., add a marker attribute)
                 if (!container.hasAttribute('data-co2-processed')) {
                     container.setAttribute('data-co2-processed', 'true'); // Mark as processed
                     console.log('New assistant response container detected:', container);

                     // Start monitoring this specific response for streaming and completion
                     monitorStreamingResponse(container);
                 }
              });
          }
        });
      }
    }
  });

  responseObserver.observe(targetNode, config);
  console.log("Response observer attached.");
}

// Monitor a specific response container for streaming text and completion
function monitorStreamingResponse(responseContainer) {
  let streamingTimer = null;
  let streamingInterval = null;
  const completionCheckDelay = 1500;
  const intervalCheckFrequency = 300;

  let startTime = Date.now();
  let isComplete = false;
  let lastChildCount = 0;
  
  const statusContainer = responseContainer.parentElement?.parentElement;
  if (!statusContainer) {
    console.error("Could not find the expected status container for monitoring completion.");
    return;
  }

  const handleCompletion = (completionTime) => {
    const responseTime = (completionTime - startTime) / 1000;
    const chatId = getChatId();

    if (!chatId) {
      console.warn("Cannot proceed: No valid chat ID at completion.");
      return;
    }
    
    if (!responseContainer.hasAttribute('data-co2-processed')) {
      console.warn("Container check failed: Missing 'data-co2-processed' attribute.");
      return; 
    }

    if (document.body.contains(responseContainer)) {
      if (!isComplete) { 
        isComplete = true;
        chrome.runtime.sendMessage({ type: 'chatgpt_response', chatId: chatId }, storedData => {
          if (chrome.runtime.lastError) {
            console.error("Error fetching stored data:", chrome.runtime.lastError);
            return;
          }
          const storedResponseCount = (storedData && typeof storedData.responseCount === 'number') ? storedData.responseCount : 0;
          const currentResponseCount = findResponseContainers().length;

          if (currentResponseCount > storedResponseCount) {
            calculateAndStoreEmissions(responseContainer, responseTime);
          } else {
            const validStoredData = storedData || { ...DEFAULT_EMISSIONS_DATA };
            updateChatEmissionsDisplay(chatId, validStoredData, responseTime); 
          }
        });
      } else {
        calculateAndStoreEmissions(responseContainer, responseTime);
      }
    }
  };
  
  const checkStatus = () => {
    const currentChildCount = statusContainer.childElementCount;

    if (currentChildCount > 1 && lastChildCount <= 1) {
      clearTimeout(streamingTimer);
      streamingTimer = null;
      handleCompletion(Date.now());

    } else if (currentChildCount <= 1 && lastChildCount > 1 && isComplete) {
      startTime = Date.now();
      clearTimeout(streamingTimer);
      streamingTimer = null;
      streamingTimer = setTimeout(() => checkStatus(), completionCheckDelay);
    }
    
    lastChildCount = currentChildCount;
  };

  streamingInterval = setInterval(checkStatus, intervalCheckFrequency);
  streamingTimer = setTimeout(() => checkStatus(), completionCheckDelay);
}

// Function to fetch existing emissions data for a specific chat and inject display
// This is called on page load/refresh/navigation for *already completed* messages
function fetchEmissionsDataForChat(container, chatId) {
    if (!chatId) {
        console.warn("Skipping fetch: No valid chat ID provided.");
        return;
    }
    console.log(`Fetching stored emissions for container in chat ${chatId}:`, container);
    chrome.runtime.sendMessage({ type: 'chatgpt_response', chatId: chatId }, response => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching emissions data:", chrome.runtime.lastError);
        injectEmissionsDisplay(container, { ...DEFAULT_EMISSIONS_DATA }); // Show default on error
        return;
      }
      if (response) {
        console.log('Received stored emissions data for chat', chatId, ':', response);
        // Inject display using the fetched data for this specific chat
        // Make sure the response structure matches what createEmissionsDisplay expects
        // Assuming the response directly contains co2, water, etc. for the specific chat
        injectEmissionsDisplay(container, {
            co2: response.co2,
            water: response.water,
            milesDriven: response.milesDriven,
            glassesOfWater: response.glassesOfWater
            // No totalQueries needed for individual display
        });
        // Update total display (optional, could be redundant if updated elsewhere)
        // if (response.totalEmissionsData) {
        //     updateTotalEmissionsDisplay(response.totalEmissionsData);
        // }
      } else {
        console.warn('No stored emissions data found for chat:', chatId);
        // Inject default/empty display if no data found
        injectEmissionsDisplay(container, { ...DEFAULT_EMISSIONS_DATA });
    }
  });
}

// Calculate live emissions (used potentially during streaming) - Returns data, doesn't store
function calculateLiveEmissions(tokens, model, elapsedTimeInSeconds) {
    const modelKey = getModelKey(model || 'default'); // Use background.js logic if possible or replicate
  const co2PerToken = CO2_PER_TOKEN[modelKey] || CO2_PER_TOKEN['default'];
  const waterPerToken = WATER_PER_TOKEN;
    const timeFactor = elapsedTimeInSeconds * TIME_FACTOR;

    const co2 = (tokens * co2PerToken) + timeFactor;
  const water = tokens * waterPerToken;
    const milesDriven = co2 / CO2_PER_MILE;
  const glassesOfWater = water / GLASS_VOLUME;

  return {
        co2,
    water,
    milesDriven,
        glassesOfWater
    };
}

// Helper function to get model key (should match background.js)
function getModelKey(modelName) {
  if (!modelName) return 'default';
  const lowerModelName = modelName.toLowerCase();
  if (CO2_PER_TOKEN[lowerModelName]) return lowerModelName;
  if (lowerModelName.includes('gpt-4') || lowerModelName.includes('gpt4')) return 'gpt-4';
  if (lowerModelName.includes('gpt-3.5') || lowerModelName.includes('gpt3.5')) return 'gpt-3.5';
  return 'default';
}

// Constants matching background.js (needed for live calculation if used)
// It's better practice to get these from background.js if possible to avoid duplication
const CO2_PER_TOKEN = { 'gpt-4': 0.0046 / 1000, 'gpt-4o': 0.0046 / 1000, 'gpt-4.5': 0.0046 / 1000, 'gpt4': 0.0046 / 1000, 'gpt-3.5': 0.0023 / 1000, 'gpt-3.5-turbo': 0.0023 / 1000, 'gpt-o3': 0.0023 / 1000, 'gpt-o4-mini': 0.0015 / 1000, 'gpt-o4-mini-high': 0.0015 / 1000, 'gpt-4o-mini': 0.0015 / 1000, 'default': 0.0023 / 1000 };
const TIME_FACTOR = 0.0001;
const WATER_PER_TOKEN = 0.5 / 1000;
const CO2_PER_MILE = 0.404;
const GLASS_VOLUME = 0.25;

// Initialize total emissions data display area
function initializeTotalEmissionsDisplayArea() {
    let totalDisplayArea = document.getElementById('co2-total-display-area');
    if (!totalDisplayArea) {

        // Find the specific page header element
        const pageHeader = document.getElementById('page-header');

        if (pageHeader) {
            // --- Make pageHeader a flex-column container --- 
            pageHeader.style.display = 'flex';
            pageHeader.style.flexDirection = 'column';
            pageHeader.style.height = 'auto'; // Allow height to adjust
            // Remove padding changes if any were applied incorrectly before
            // pageHeader.style.paddingBottom = '';

            // --- Create and Prepend Our Display Area --- 
            // Ensure display area doesn't exist from previous runs first
            let existingDisplayArea = pageHeader.querySelector('#co2-total-display-area');
            if (existingDisplayArea) existingDisplayArea.remove(); 
            
            totalDisplayArea = document.createElement('div');
            totalDisplayArea.id = 'co2-total-display-area';
            totalDisplayArea.style.width = '100%'; 
            totalDisplayArea.style.boxSizing = 'border-box';
            
            // Prepend the display area so it's first in the flex column
            pageHeader.prepend(totalDisplayArea);
            console.log("Prepended #co2-total-display-area inside #page-header.");
            // --- End Display Area Creation --- 
            
            // --- Wrap and Append Existing Content --- 
            // Ensure wrapper doesn't exist from previous runs
            let existingWrapper = pageHeader.querySelector('#header-content-wrapper');
            if (existingWrapper) existingWrapper.remove(); 
            
            let headerContentWrapper = document.createElement('div');
            headerContentWrapper.id = 'header-content-wrapper';
            headerContentWrapper.style.display = 'flex';
            headerContentWrapper.style.alignItems = 'center';
            headerContentWrapper.style.justifyContent = 'space-between';
            headerContentWrapper.style.width = '100%';

            const originalChildren = Array.from(pageHeader.childNodes);
            originalChildren.forEach(child => {
                 // Only move nodes that are NOT the wrapper itself or the display area
                if (child.id !== 'co2-total-display-area' && child.id !== 'header-content-wrapper') {
                    headerContentWrapper.appendChild(child);
                }
            });
            // Append the wrapper so it appears second visually in the column
            pageHeader.appendChild(headerContentWrapper);
            console.log("Wrapped and appended existing header content in #header-content-wrapper.");
            // --- End Wrapping ---

        } else {
            // Fallback: Prepend to main content area if page header isn't found
            console.warn("#page-header not found. Falling back to prepending to main.");
            totalDisplayArea = document.createElement('div'); // Create here for fallback
            totalDisplayArea.id = 'co2-total-display-area'; 
            const mainContentArea = document.querySelector('main') || document.body;
            mainContentArea.prepend(totalDisplayArea);
        }
    }
     // Ensure we return the correct, potentially newly created/found element
     return document.getElementById('co2-total-display-area'); 
}

// Fetch and display total emissions
function fetchAndDisplayTotalEmissions() {
    console.log("Fetching total emissions data...");
    chrome.runtime.sendMessage({ type: 'get_total_emissions' }, response => {
         if (chrome.runtime.lastError) {
           console.error("Error fetching total emissions:", chrome.runtime.lastError);
           return;
         }
         if (response && response.totalEmissionsData) {
           console.log('Received total emissions data:', response.totalEmissionsData);
           updateTotalEmissionsDisplay(response.totalEmissionsData);
         } else {
             console.warn("No total emissions data received.");
              // Optionally display default/zero state
              updateTotalEmissionsDisplay({ ...DEFAULT_EMISSIONS_DATA });
    }
  });
}

// Update total emissions display element
function updateTotalEmissionsDisplay(data) {
    const totalDisplayArea = initializeTotalEmissionsDisplayArea(); // Ensure area exists and structure is correct
    if (!totalDisplayArea) {
        console.error("Failed to get or create total display area for update.");
        return;
    }
    console.log("[updateTotalEmissionsDisplay] Received data:", data); // DEBUG LOG
    // Create the new content structure, passing the full data object
    let totalDisplayContent = createTotalEmissionsDisplay(data); 
    // Replace content of the display area
    totalDisplayArea.innerHTML = totalDisplayContent.innerHTML; 
    // Apply necessary styles directly to the area
    totalDisplayArea.style.display = 'flex'; 
    totalDisplayArea.style.alignItems = 'center'; 
    totalDisplayArea.style.justifyContent = 'space-between'; 
    
    const isDarkMode = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDarkMode) {
        totalDisplayArea.style.color = '#fff';
    } else {
        totalDisplayArea.style.color = '#333';
    }
    
    // Ensure the reset button listener is attached after updating innerHTML
    addResetButtonListener();

    console.log("Updated total emissions display (flex row wrapped approach).", totalDisplayArea);
}

// **NEW**: Function to create chat-specific emissions display (for the bottom)
function createChatEmissionsDisplay(data, responseTime = 0) {
  const container = document.createElement('div');
  container.id = 'co2-chat-emissions'; // Unique ID for the bottom display
  // Basic styling - adjust as needed
  container.style.padding = '8px 16px';
  container.style.borderTop = '1px solid rgba(0, 0, 0, 0.1)';
  container.style.fontSize = '0.8rem';
  container.style.marginTop = '10px'; // Add some space above it
  container.style.width = '100%';
  container.style.boxSizing = 'border-box';

  // Apply dark mode styles
  const isDarkMode = document.documentElement.classList.contains('dark') ||
                     document.body.classList.contains('dark') ||
                     window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (isDarkMode) {
    container.style.backgroundColor = '#1e1e1e'; // Slightly different shade maybe
    container.style.color = '#ccc';
    container.style.borderColor = 'rgba(255, 255, 255, 0.1)';
  } else {
    container.style.backgroundColor = '#f9f9f9';
    container.style.color = '#555';
  }

  // Ensure all values exist and are numbers
  const co2 = typeof data.co2 === 'number' ? data.co2 : 0;
  const kilometersDriven = typeof data.kilometersDriven === 'number' ? data.kilometersDriven : 0;
  const water = typeof data.water === 'number' ? data.water : 0;
  const totalQueries = typeof data.totalQueries === 'number' ? data.totalQueries : 0; // For this chat

  // --- Meter Logic (Re-added and Adapted) ---
  const co2ThresholdKm = 1; // 1 km threshold for CO2 equivalent
  const waterThresholdL = 10; // 10 L threshold for Water

  const co2Progress = Math.min(kilometersDriven / co2ThresholdKm, 1);
  const waterProgress = Math.min(water / waterThresholdL, 1);

  const exceededThreshold = kilometersDriven > co2ThresholdKm || water > waterThresholdL;
  const animationStyle = exceededThreshold ?
    '@keyframes chatVibrate {0%, 100% { transform: translateX(0); } 25% { transform: translateX(-1px); } 75% { transform: translateX(1px); }}' : ''; // Subtle vibration

  const cssStyles = `
    <style>
      ${animationStyle}
      .chat-progress-container {
        width: 100%;
        height: 12px; /* Smaller height for bottom display */
        background-color: ${isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)'};
        border-radius: 6px;
        overflow: hidden;
        margin: 4px 0 8px 0; /* Adjusted margin */
        position: relative;
      }
      .chat-progress-bar {
        height: 100%;
        position: absolute;
        left: 0;
        top: 0;
        border-radius: 6px;
        transition: width 0.5s ease-in-out;
        ${exceededThreshold ? 'animation: chatVibrate 0.3s ease-in-out infinite;' : ''}
      }
      .chat-co2-bar { background-color: ${exceededThreshold ? '#e57373' : '#81c784'}; width: ${co2Progress * 100}%; }
      .chat-water-bar { background-color: ${exceededThreshold ? '#ffb74d' : '#64b5f6'}; width: ${waterProgress * 100}%; }
      .chat-progress-label {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
        font-weight: 500;
        font-size: 0.75rem; /* Slightly smaller font */
      }
      .chat-emoji { margin-right: 4px; }
      .chat-info-divider { margin: 0 8px; color: #999; }
      
      /* --- Popover Styles --- */
      .emissions-info-popover-wrapper {
        position: relative;
        display: inline-block;
        margin-top: 10px; /* Space above the link */
        width: 100%; /* Make wrapper take full width for centering */
        text-align: center; /* Center the trigger text */
      }
      .emissions-info-trigger {
        font-size: 0.7rem;
        color: ${isDarkMode ? '#aaa' : '#666'}; 
        text-decoration: underline;
        cursor: pointer;
      }
      .emissions-info-popover-content {
        visibility: hidden; /* Use visibility to handle transitions potentially later */
        opacity: 0;
        position: absolute;
        bottom: 100%; /* Position above the trigger */
        left: 50%;
        transform: translateX(-50%); /* Center horizontally */
        width: max-content; /* Adjust width to content */
        max-width: 300px; /* Max width */
        background-color: ${isDarkMode ? '#333' : '#fff'}; 
        color: ${isDarkMode ? '#ddd' : '#333'}; 
        border: 1px solid ${isDarkMode ? '#555' : '#ccc'}; 
        border-radius: 6px;
        padding: 10px;
        z-index: 10;
        font-size: 0.75rem;
        text-align: left;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        margin-bottom: 5px; /* Space between trigger and popover */
        transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
      }
      .emissions-info-popover-wrapper:hover .emissions-info-popover-content {
        visibility: visible;
        opacity: 1;
      }
      .emissions-info-popover-content ul {
        margin: 0;
        padding: 0 0 0 15px; /* Indent list items */
        list-style: disc;
      }
       .emissions-info-popover-content li {
        margin-bottom: 4px;
      }
    </style>
  `;
  // --- End Meter Logic & Styles ---

  // Set innerHTML with emissions info, emojis, meters, response time, AND popover
  container.innerHTML = `
    ${cssStyles}
    <div style="font-weight: bold; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
      <span>Chat Emissions (${totalQueries} queries)</span>
      ${responseTime > 0 ? `<span style="font-weight: normal; font-size: 0.7rem; color: #888;">Response Time: ${responseTime.toFixed(1)} s</span>` : ''}
    </div>
    <div class="chat-progress-label">
      <span><span class="chat-emoji">🚗</span>CO₂ Equiv.</span>
      <span>${kilometersDriven.toFixed(2)} / ${co2ThresholdKm.toFixed(2)} km</span>
    </div>
    <div class="chat-progress-container">
      <div class="chat-progress-bar chat-co2-bar"></div>
    </div>

    <div class="chat-progress-label">
      <span><span class="chat-emoji">💧</span>Water Usage</span>
      <span>${water.toFixed(2)} / ${waterThresholdL.toFixed(1)} L</span>
    </div>
    <div class="chat-progress-container">
      <div class="chat-progress-bar chat-water-bar"></div>
    </div>

    <!-- Popover Element -->
    <div class="emissions-info-popover-wrapper">
      <span class="emissions-info-trigger">How can I reduce my emissions?</span>
      <div class="emissions-info-popover-content">
        Ways to reduce your footprint:
        <ul>
          <li>Use simpler tools (calculator, search engine) for simple tasks.</li>
          <li>Avoid unnecessary messages like "Hi" or "Thanks".</li>
          <li>Prefer faster models (like 3.5 or 4o mini) over slower ones (like 4).</li>
          <li>Limit image generation requests.</li>
          <li>Keep prompts concise and request shorter answers where possible.</li>
        </ul>
      </div>
    </div>
  `;

  return container;
}

// **NEW**: Function to initialize the bottom chat display area
function initializeChatDisplayArea() {
    let chatDisplayArea = document.getElementById('co2-chat-display-area');
    if (!chatDisplayArea) {
        chatDisplayArea = document.createElement('div');
        chatDisplayArea.id = 'co2-chat-display-area';

        // Find the chat input form (this selector might need adjustment)
        const formElement = document.querySelector('form'); // Look for the main form

        if (formElement && formElement.parentNode) {
            // Insert the display area *before* the form element
            formElement.parentNode.insertBefore(chatDisplayArea, formElement);
            console.log("Inserted chat display area before form.");
        } else {
            // Fallback: Append to main content area if form isn't found
            console.warn("Chat input form not found. Falling back to appending chat display to main.");
            const mainContentArea = document.querySelector('main') || document.body;
            mainContentArea.appendChild(chatDisplayArea);
        }
    }
    return chatDisplayArea;
}

// **NEW**: Function to fetch and update the bottom chat emissions display
function updateChatEmissionsDisplay(chatId, specificData = null, responseTime = 0) {
    const chatDisplayArea = initializeChatDisplayArea(); // Ensure area exists
    if (!chatDisplayArea) return; // Should not happen, but safety check

    const displayUpdateCallback = (chatData) => {
        if (!chatData) {
             console.warn(`No emissions data found for chat ${chatId} to update bottom display.`);
             // Optionally clear the display or show zeros
             chatData = { ...DEFAULT_EMISSIONS_DATA }; // Use default structure
        }

        let chatDisplay = document.getElementById('co2-chat-emissions');
        if (!chatDisplay) {
            // Pass responseTime when creating for the first time
            chatDisplay = createChatEmissionsDisplay(chatData, responseTime);
            chatDisplayArea.innerHTML = ''; // Clear previous content if any
            chatDisplayArea.appendChild(chatDisplay);
        } else {
            // Update existing display content, passing responseTime
            const newContent = createChatEmissionsDisplay(chatData, responseTime);
            chatDisplay.innerHTML = newContent.innerHTML;
             // Re-apply styles if needed (e.g., dark mode)
             const isDarkMode = document.documentElement.classList.contains('dark') ||
                                document.body.classList.contains('dark') ||
                                window.matchMedia('(prefers-color-scheme: dark)').matches;
             if (isDarkMode) {
                chatDisplay.style.backgroundColor = '#1e1e1e';
                chatDisplay.style.color = '#ccc';
                chatDisplay.style.borderColor = 'rgba(255, 255, 255, 0.1)';
             } else {
                chatDisplay.style.backgroundColor = '#f9f9f9';
                chatDisplay.style.color = '#555';
                chatDisplay.style.borderColor = 'rgba(0, 0, 0, 0.1)';
             }
        }
        console.log(`Updated bottom chat emissions display for chat ${chatId} (Response Time: ${responseTime}s).`);
    };

    if (specificData) {
        // If data was passed directly (e.g., from background response), use it along with responseTime
        console.log(`Updating bottom display with provided data for chat ${chatId}:`, specificData);
        displayUpdateCallback(specificData);
    } else if (chatId && chatId !== 'unknown-chat' && chatId !== null) {
        // Otherwise, fetch it from storage if we have a valid chat ID
        // Note: Fetching from storage won't have the specific responseTime of the *last* message
        // So we only display responseTime when it's passed directly after calculation.
        console.log(`Fetching data to update bottom display for chat ${chatId}...`);
        chrome.runtime.sendMessage({ type: 'chatgpt_response', chatId: chatId }, response => {
            if (chrome.runtime.lastError) {
                console.error("Error fetching chat emissions data for bottom display:", chrome.runtime.lastError);
                displayUpdateCallback(null); // Show default/error state
                return;
            }
            // Pass 0 for responseTime when just fetching stored data
            displayUpdateCallback(response);
        });
    } else {
        // No valid chatId and no specific data provided, show default/empty state
        console.log("No valid chat ID to fetch data for bottom display, showing default.");
        displayUpdateCallback(null);
    }
}

// Ensure calls to updateChatEmissionsDisplay exist in initialize and the callback of calculateAndStoreEmissions

// Need default emissions structure for the bottom display fallback
const DEFAULT_EMISSIONS_DATA = {
  co2: 0,
  water: 0,
  milesDriven: 0,
  glassesOfWater: 0,
  totalQueries: 0,
  responseCount: 0 // Keep this consistent if background.js uses it
};

// Add Event Listener for Reset Button (using event delegation on the parent area)
function addResetButtonListener() {
    const totalDisplayArea = document.getElementById('co2-total-display-area');
    if (totalDisplayArea && !totalDisplayArea.dataset.listenerAttached) { // Prevent multiple listeners
        console.log("Attaching reset button listener to area:", totalDisplayArea);
        totalDisplayArea.addEventListener('click', (event) => {
            if (event.target && event.target.id === 'reset-total-button') {
                console.log("Reset Total button clicked");
                if (confirm("Are you sure you want to reset the total emissions tracker AND the current chat's emissions?")) {
                    const currentChatIdForReset = getChatId(); // Get current chat ID at time of reset
                    console.log("Sending reset request for total and chat:", currentChatIdForReset);
                    chrome.runtime.sendMessage({ 
                        type: 'reset_total_emissions', 
                        chatId: currentChatIdForReset // Include current chat ID
                    }, response => {
                        if (chrome.runtime.lastError) {
                            console.error("Error sending reset message:", chrome.runtime.lastError);
                            alert("Failed to reset totals. See console for details.");
                            return;
                        }
                        if (response && response.success) {
                            console.log("Reset successful signaled by background.");
                            // Re-fetch and update BOTH displays
                            fetchAndDisplayTotalEmissions();
                            updateChatEmissionsDisplay(currentChatIdForReset); // Update bottom display for the reset chat
                        } else {
                            console.error("Background script reported failure during reset:", response);
                            alert("Failed to reset totals. Background script reported an error.");
                        }
                    });
                }
            }
        });
        totalDisplayArea.dataset.listenerAttached = 'true'; // Mark as attached
    }
}

// --- Main Execution ---
// Use a delay or wait for document ready state to ensure page elements are loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  // `DOMContentLoaded` already fired
  setTimeout(initialize, 500); // Add a small delay to ensure SPA elements render
}

// Optional: Add listener for visibility changes if needed
// document.addEventListener("visibilitychange", () => {
//   if (document.visibilityState === 'visible') {
//     console.log("Tab became visible, re-initializing...");
//     initialize(); // Re-check state when tab becomes visible
//   }
// });

console.log("ChatGPT CO2 Tracker content script loaded."); 
# ChatGPT CO2 Tracker - Privacy Policy and Permissions Justification

## Single Purpose Description
The ChatGPT CO2 Tracker extension monitors and displays the environmental impact of ChatGPT conversations by calculating CO2 emissions and water usage based on response tokens and processing time. It provides real-time feedback to users about their AI usage's environmental footprint.

## Required Permissions and Justifications

### activeTab Permission
**Justification**: The extension requires the `activeTab` permission to:
- Monitor ChatGPT conversations in real-time
- Inject emissions display elements into the ChatGPT interface
- Calculate emissions based on response content and timing
- Update the UI with environmental impact metrics

### Host Permissions
**Justification**: The extension requires host permissions for `chat.openai.com` to:
- Access and analyze ChatGPT conversation content
- Calculate emissions based on response tokens
- Display emissions information within the ChatGPT interface
- Monitor response streaming and completion states

### Remote Code
**Justification**: The extension does not use any remote code. All calculations and UI updates are performed locally within the extension's context.

### Scripting
**Justification**: The extension uses scripting to:
- Monitor DOM changes for new ChatGPT responses
- Calculate emissions based on response content
- Update the UI with environmental impact metrics
- Handle user interactions with the emissions display

### Storage
**Justification**: The extension uses `chrome.storage.local` to:
- Store cumulative emissions data across sessions
- Track emissions per chat conversation
- Maintain user preferences and settings
- Store tracking start date and historical data

## Data Usage Compliance

### Data Collection
- The extension only collects and processes data necessary for emissions calculations
- All data is stored locally in the user's browser
- No data is sent to external servers
- No personal or sensitive information is collected

### Data Processing
- Emissions calculations are performed locally
- Token counting is done client-side
- Response timing is measured locally
- All calculations use publicly available emissions factors

### Data Storage
- Data is stored using Chrome's local storage API
- Data is only accessible to the extension
- Users can reset stored data at any time
- Data is not shared with third parties

### Data Security
- All calculations and storage are performed locally
- No API keys or sensitive credentials are stored
- No network requests are made to external servers
- Data is not transmitted outside the user's browser

## Developer Certification
I certify that this extension:
1. Only collects data necessary for emissions calculations
2. Processes all data locally in the user's browser
3. Does not transmit any data to external servers
4. Complies with Chrome Web Store's Developer Program Policies
5. Respects user privacy and data protection
6. Provides clear information about data usage
7. Allows users to reset or clear their data at any time 
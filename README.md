# ChatGPT CO2 Tracker

A Chrome extension that tracks and displays the environmental impact of your ChatGPT conversations by estimating CO2 emissions and water usage.

## Features

- Real-time tracking of CO2 emissions and water usage for each ChatGPT conversation
- Total footprint display showing cumulative impact across all conversations
- Model-specific emissions calculations (supports GPT-3.5, GPT-4, and other variants)
- Response time tracking and display
- Ability to reset emissions data for individual chats or total footprint
- Dark mode support

## Installation

1. Clone this repository or download the source code
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory

## How It Works

The extension monitors your ChatGPT conversations and calculates environmental impact based on:

- Number of tokens in responses
- Response time
- Model type (GPT-3.5, GPT-4, etc.)
- Standard emissions factors for AI model inference

### Emissions Calculation

The extension uses the following methodology:

- CO2 emissions: Based on model-specific token processing rates and energy consumption
- Water usage: Calculated from data center cooling requirements
- Response time: Monitored to account for streaming and processing duration

## Privacy & Security

- All calculations are performed locally in your browser
- No data is sent to external servers
- No API keys or sensitive information is stored
- Emissions data is stored locally in Chrome's storage

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Acknowledgements

- Emissions calculations based on research from [source]
- Inspired by the need for transparency in AI environmental impact 
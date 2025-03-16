# replicate-api

```markdown
# AI Image Generation Web Interface

[![Live Demo](https://img.shields.io/badge/demo-live-green.svg)(https://tesla.x10.mx/)]
Pure browser-based interface for Replicate's AI models using vanilla JavaScript

![Interface Preview](https://via.placeholder.com/800x400.png?text=Browser-based+AI+Image+Generator)

## Features

- 🚀 Zero dependencies - pure HTML/CSS/JS
- 🌐 Works directly in modern browsers
- 🔄 Real-time mask editing canvas
- 📦 Single-file architecture
- 🔐 API key based authentication
- 🖼️ Automatically fetch required model fields via API, you can add any model to modelList in javascript code in the same format as existing models.

## Quick Start

1. **Clone or download** the repository:
```bash
git clone https://github.com/lunedor/replicate-api.git
```

2. **Open in browser**:
   - Double-click `index.html` or
   - Serve via local web server:
     ```bash
     python3 -m http.server 8000
     ```
     Then open `http://localhost:8000`

3. **Get API key** from [Replicate.com](https://replicate.com/account)

4. **Start creating**:
   - Enter API key
   - Select model
   - Provide inputs
   - Generate!

## File Structure

```
/
├── index.html          # Main interface
├── replicate.js        # Core logic
├── styles.css          # Styling
└── README.md           # This documentation
```

## Browser Requirements

- Modern browser (Chrome 114+, Firefox 115+, Edge 114+)
- JavaScript enabled
- WebGL support (for canvas rendering)

## Development

1. **Edit files** directly in any text editor
2. **Test changes** by refreshing browser
3. **Debug** using browser developer tools (F12)

## Deployment

1. Use the html file to make it work.
2. If you face any CORS error then upload all files to web hosting or serve via local web server.

## Why Vanilla JS?

- ⚡ Instant loading - no build step
- 🔍 Easy to debug
- 💾 Minimal footprint (~50KB total)
- 🔄 Direct browser execution

## Troubleshooting

**Images not loading**:
- Check browser console for errors (F12)
- Verify API key permissions
- Ensure model supports output type

**Canvas issues**:
- Refresh after uploading base image
- Clear browser cache if drawing lags

**API errors**:
- Verify Replicate account status
- Check model version compatibility
- Ensure network connectivity

## License

MIT License - free for personal and commercial use
```


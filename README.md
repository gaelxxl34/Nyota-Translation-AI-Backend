# Nyota Translation Center (NTC) - Backend

This is the backend API server for the Nyota Translation Center, a web application that allows authenticated users to upload French school bulletins, extract and translate them using OpenAI, and render English-language report cards.

## Tech Stack

- Node.js + Express
- Multer for file uploads
- OpenAI JS SDK for AI-powered translation
- EJS for PDF report generation
- Firebase Admin + Firestore for authentication and data storage
- Puppeteer for PDF generation

## Setup Instructions

1. **Install dependencies**

```bash
npm install
```

2. **Configure environment variables**

Copy the example environment file and update it with your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your OpenAI API key and other settings.

3. **Set up Firebase Service Account**

Copy the example service account key file and replace it with your Firebase service account credentials:

```bash
cp config/serviceAccountKey.example.json config/serviceAccountKey.json
```

Obtain your Firebase service account key from:
Firebase Console > Project Settings > Service Accounts > Generate New Private Key

4. **Start the development server**

```bash
npm run dev
```

The server will start on port 3001 by default (or the port specified in your .env file).

## API Endpoints

- `POST /api/upload` - Upload a bulletin file (PDF/image)
- `GET /api/reports/:id` - Get a translated report by ID
- `GET /api/pdf/:id` - Generate and download a PDF report

## Environment Variables

| Variable | Description |
|----------|-------------|
| PORT | Server port (default: 3001) |
| NODE_ENV | Environment (development/production) |
| OPENAI_API_KEY | Your OpenAI API key |
| SERVICE_ACCOUNT_KEY_PATH | Path to Firebase service account key |

## Directory Structure

- `src/` - Source code
  - `index.js` - Main server entry point
  - `config.js` - Configuration setup
  - `auth.js` - Firebase authentication middleware
  - `openai-optimized.js` - OpenAI client and translation functions
  - `routes/` - API route handlers
    - `upload.js` - File upload endpoints
    - `pdf.js` - PDF generation endpoints
  - `middleware/` - Express middleware
- `config/` - Configuration files
  - `serviceAccountKey.example.json` - Template for Firebase service account
- `uploads/` - Directory for temporary file uploads
- `public/` - Public static files (if any)

## Development

- Use `npm run dev` to start the server with nodemon for auto-reloading
- API endpoints are protected with Firebase Authentication

## License

ISC

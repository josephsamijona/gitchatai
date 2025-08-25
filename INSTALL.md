# Installation Guide

This guide will walk you through the process of setting up the Synapse project on your local machine for development and testing.

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Git](https://git-scm.com/)

## Setup

### 1. Clone the Repository

First, clone the project repository to your local machine:

```bash
git clone https://github.com/your-username/synaps-branch.git
cd synaps-branch
```

### 2. Install Dependencies

Install the necessary project dependencies using npm:

```bash
npm install
```

### 3. Set Up Environment Variables

The project requires several environment variables to connect to services like TiDB Cloud and various AI model APIs.

Create a new file named `.env` in the root of the project directory:

```bash
touch .env
```

Open the `.env` file and add the following variables. You will need to obtain these keys from their respective platforms.

```env
# TiDB Serverless Connection
TIDB_HOST=your_tidb_host
TIDB_PORT=4000
TIDB_USER=your_tidb_user
TIDB_PASSWORD=your_tidb_password

# AI Model API Keys
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
KIMI_API_KEY=your_kimi_api_key
GROK_API_KEY=your_grok_api_key

# Other Services
REDIS_URL=your_redis_url
S3_BUCKET_NAME=your_s3_bucket_name
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
```

### 4. Run Database Migrations

The project includes database migration scripts to set up the required schema in your TiDB Serverless instance.
*(Note: The command to run migrations will be added here once implemented.)*

## Running the Application

### Development Mode

To start the development server with hot-reloading enabled:

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).

### Production Mode

To build the application for production:

```bash
npm run build
```

To start the production server:

```bash
npm run start
```

## Linting

To check the code for any linting errors:

```bash
npm run lint
```
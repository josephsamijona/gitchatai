

---

# 🚀 SYNAPSE: Git-Style Version Control for AI Conversations

![Synapse Logo](docs/assets/logo.png) <!-- optional -->

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Open Source Love](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)](https://opensource.org/licenses)
[![Built with TiDB](https://img.shields.io/badge/Built%20with-TiDB%20Serverless-orange)](https://tidbcloud.com)

---

## 📋 Project Overview

**Synapse** is an AI-powered collaboration platform that introduces **Git-style version control to conversations**.
Unlike traditional linear chatbots, Synapse enables users to **branch, merge, and navigate through multiple conversation timelines**, empowering researchers, students, and organizations to explore complex problems in a non-linear, reproducible way.

### 🌍 Social Good Impact

* Democratizes **knowledge exploration** by making complex research interactive and collaborative.
* Designed for **education, NGOs, and social impact projects**, where multiple perspectives must be compared and synthesized.
* Helps teams working on **climate research, healthcare, and policy-making** to reason through problems faster and more transparently.

---

## ✨ Core Features

* 🌱 **Branching Conversations** → Fork any AI response to explore alternative paths.
* 🤖 **Multi-Model Orchestration** → Seamlessly switch between GPT-4, Claude, Kimi, and Grok.
* 🔍 **Knowledge Synthesis** → Extract key concepts and visualize them in a knowledge graph.
* 📂 **Project Workspaces** → Organize research projects with persistent memory and document upload.
* 🔄 **Merge & Compare** → Combine insights across branches into a single synthesized view.
* 🎨 **Interactive Visuals** → Git-style conversation tree + 3D knowledge graph.

---

## 🛠️ Tech Stack

* **Frontend**: React 18 + TypeScript + Tailwind CSS
* **Backend**: Node.js + Express
* **Database**: PostgreSQL + TiDB Serverless (Vector Search)
* **Real-time**: WebSockets
* **Storage**: AWS S3 (documents), Redis (caching)

---

## 🗂️ Architecture

![Architecture Diagram](docs/assets/architecture.png) <!-- placeholder -->

**Workflow:**

1. User starts a conversation → stored in TiDB + vector embeddings.
2. Conversations branch → stored as nodes in a Git-style tree.
3. Knowledge base documents are ingested, embedded, and indexed.
4. Users can visualize, compare, and merge conversation flows.

---

## 🚦 Quick Start

### Prerequisites

* Node.js >= 18
* TiDB Cloud account (Serverless)
* API keys for LLMs (OpenAI, Anthropic, etc.)

### Installation

```bash
# Clone repository
git clone https://github.com/<your-org>/synapse.git
cd synapse

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Run development server
npm run dev
```

---

## 🎥 Demo

👉 [Demo Video](https://devpost.com/software/synapse) *(required for Devpost submission)*

📸 Screenshots:
![Main Chat View](docs/assets/chat.png)
![Branch Visualizer](docs/assets/tree.png)
![Knowledge Graph](docs/assets/graph.png)

---

## 🌍 Example Use Cases

* **Education** → Students explore multiple answers and merge findings into research reports.
* **Healthcare** → Doctors simulate alternative diagnoses and synthesize treatment options.
* **Climate Research** → NGOs upload datasets and collaboratively reason through solutions.

---

## 🤝 Contributing

We welcome contributions!

1. Fork this repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---

## 👤 Authors

**Samuel Jonathan JOSEPH** – Project Lead

---

## 🏆 Hackathon Submission

* Built for: **[TiDB AgentX Hackathon 2025](https://tidb.devpost.com/)**
* Categories: **Open Source Award**, **Social Good Award**, **First Place Goal 🥇**

---


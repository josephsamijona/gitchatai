# Frequently Asked Questions (FAQ)

### General

**Q: What is Synapse?**

**A:** Synapse is a revolutionary AI conversation platform that introduces Git-style version control (branching, merging, etc.) to AI interactions. It allows you to explore multiple paths in a conversation, compare answers from different AI models, and build a visual "knowledge graph" of your discoveries.

**Q: What is the core innovation?**

**A:** The main innovation is **conversational branching**. Unlike a standard, linear chatbot, Synapse lets you "fork" the conversation at any message to explore a different idea or ask a follow-up question without losing your original context.

**Q: What problem does Synapse solve?**

**A:** It solves the limitation of linear AI conversations. When exploring complex topics, you often have multiple lines of inquiry. Synapse allows you to pursue them all in parallel within a single, organized workspace, making it ideal for research, analysis, and creative brainstorming.

---

### Technical

**Q: What is the technology stack?**

**A:** Synapse is built with a modern web stack:
- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend:** Node.js with Next.js API Routes
- **Database:** TiDB Serverless (for its powerful hybrid search and analytics)
- **Visualizations:** D3.js and Three.js

**Q: Why is TiDB Serverless used?**

**A:** TiDB is central to Synapse's functionality. We use it for more than just storage. Its native **vector search** capabilities are essential for finding semantically similar information in conversations and documents. Its **Hybrid Transactional/Analytical Processing (HTAP)** features allow us to run real-time analytics without impacting performance.

**Q: How does the multi-model orchestration work?**

**A:** Synapse has a built-in orchestration layer that allows you to switch between different large language models (like Claude, GPT-4, Kimi, and Grok) in the middle of a conversation. The platform preserves the conversational context, sending it to the newly selected model so you can continue your exploration seamlessly.

---

### Community

**Q: Is Synapse open source?**

**A:** Yes! The project is licensed under the MIT License. We believe in the power of community and welcome contributions.

**Q: How can I contribute to the project?**

**A:** We'd love to have your help! Please check out our [**CONTRIBUTING.md**](CONTRIBUTING.md) file for guidelines on how to get started, set up your development environment, and submit pull requests.

**Q: What are the social good aspects of this project?**

**A:** A core goal of Synapse is to democratize access to advanced research tools. By being low-cost and accessible, we aim to empower students, educators, and non-profits, particularly in developing countries, to conduct deep research and collaborate globally. You can read more in our [**SOCIAL_GOOD.md**](SOCIAL_GOOD.md) file.

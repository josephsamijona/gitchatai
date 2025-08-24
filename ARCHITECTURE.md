
---

# Project Architecture

This document explains the overall architecture of the **Synapse Chat Platform** project, including the folder structure, main components, data flow, and extensibility points.

---

## Table of Contents

1. [Overview](#overview)
2. [Folder Structure](#folder-structure)
3. [App Router (Next.js 13+)](#app-router-nextjs-13)
4. [Components](#components)
5. [Libraries & Utilities](#libraries--utilities)
6. [Hooks & State Management](#hooks--state-management)
7. [Animations](#animations)
8. [Styles & Themes](#styles--themes)
9. [Public Assets](#public-assets)
10. [Data Flow](#data-flow)
11. [Extensibility Points](#extensibility-points)

---

## Overview

The **Synapse Chat Platform** is built using **Next.js 13+ (App Router)**, **TypeScript**, **Tailwind CSS**, and integrates **AI models** for conversational features. The platform is structured for modularity, maintainability, and scalability.

Key principles:

* Separation of concerns
* Reusable components
* Clear API and state management
* Scalable folder structure for features like chat, branching, knowledge graphs, and projects

---

## Folder Structure

```
src/
├── app/                 # App Router with pages and layouts
├── components/          # Reusable UI & feature components
├── lib/                 # API clients, AI integrations, database utilities
├── hooks/               # Custom React hooks
├── store/               # Zustand state management
├── animations/          # Framer Motion variants & reusable transitions
├── types/               # TypeScript type definitions
├── styles/              # CSS & Tailwind globals/themes
└── public/              # Static assets: images, videos, sounds
```

---

## App Router (Next.js 13)

* **`app/layout.tsx`**: Root layout with providers
* **`app/page.tsx`**: Landing page
* **`app/(auth)/`**: Authentication routes (login, register)
* **`app/chat/`**: Main chat application

  * `[conversationId]/page.tsx`: Conversation view
  * `branch/[branchId]/page.tsx`: Branch view
  * `tree/page.tsx`: Tree visualizer
  * `project/[projectId]/`: Project dashboard, knowledge graph, settings
* **`app/api/`**: API routes for chat, branches, projects, knowledge

---

## Components

* **UI Components (`components/ui`)**: Button, Card, Modal, Input, Tooltip, etc.
* **Layout (`components/layout`)**: Header, Sidebar, Footer
* **Chat (`components/chat`)**: ChatContainer, Messages, ModelSelection
* **Branching (`components/branching`)**: BranchCreator, BranchVisualizer, BranchComparison, BranchMerger
* **Projects (`components/projects`)**: ProjectDashboard, DocumentManager, KnowledgeBase, CustomInstructions
* **Search (`components/search`)**: UniversalSearch, TextHighlight
* **Landing (`components/landing`)**: Hero, Features, Testimonials, CTA
* **Shared (`components/shared`)**: LoadingSpinner, ErrorBoundary, EmptyState, ConfirmDialog, NotificationToast

---

## Libraries & Utilities

* **API clients (`lib/api`)**: Endpoints for chat, branches, projects, knowledge
* **Database (`lib/db`)**: Migrations, schema, queries
* **AI integrations (`lib/ai`)**: OpenAI, Claude, Kimi, Grok orchestrator
* **Utils (`lib/utils`)**: Formatting, validation, constants, helpers
* **Config (`lib/config`)**: Database, Redis, S3 configuration

---

## Hooks & State Management

* **Hooks (`hooks/`)**: useChat, useBranching, useProjects, useKnowledgeGraph, useSearch, useWebSocket, useLocalStorage, useKeyboardShortcuts
* **State (`store/`)**: chatStore, branchStore, projectStore, uiStore (Zustand)

---

## Animations

* **Variants (`animations/variants`)**: Message, modal, tree, page
* **Transitions (`animations/transitions`)**: slideIn, fadeScale, stagger, spring
* **Animation hooks (`animations/hooks`)**: useMessageAnimation, useBranchAnimation, useScrollAnimation
* **Configuration (`animations/config/motion.ts`)**: Framer Motion global settings

---

## Styles & Themes

* **Global CSS**: `globals.css` (Tailwind + base styles)
* **Component styles**: `components.css`
* **Animations**: `animations.css`
* **Themes**: `light.css`, `dark.css`

---

## Public Assets

* **Images (`public/images`)**: Landing, icons, avatars
* **Videos (`public/videos/demo`)**: Demo videos
* **Sounds (`public/sounds`)**: Notification sounds
* **Models (`public/models`)**: 3D assets for knowledge graph

---

## Data Flow

1. **Frontend** triggers actions via hooks (useChat, useProjects)
2. **API routes** handle requests and call **AI integrations** or database queries
3. **AI services** generate responses (OpenAI, Claude, Kimi)
4. **State store** (Zustand) updates components reactively
5. **UI components** render updated data (chat messages, branch trees, dashboards)

---

## Extensibility Points

* Add new **AI models** in `lib/ai/`
* Add new **feature modules** under `components/` and `app/`
* Extend **database schemas** via `lib/db/migrations`
* Extend **theme system** in `styles/themes/`

---

This architecture ensures **scalability, maintainability, and clarity** for developers and judges alike.

---



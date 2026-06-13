# Browser Extension

## Table of Contents

- [Browser Extension](#browser-extension)
  - [Table of Contents](#table-of-contents)
  - [🧭Overview](#overview)
  - [📁Structure](#structure)
    - [public](#public)
    - [src/components/](#srccomponents)
    - [src/models/](#srcmodels)
    - [src/pages/](#srcpages)
    - [src/providers/](#srcproviders)
    - [src/styles/](#srcstyles)
    - [src/utils/](#srcutils)
    - [src/API.tsx](#srcapitsx)
    - [vite.config.ts](#viteconfigts)

## 🧭Overview

This folder contains the React-based Chrome extension that serves as the student interface for the EduWallet system. The extension allows students to access and manage their academic records wallet.

> **Note:** The extension was written against an earlier API and has not been updated. It likely does not work with the current system, which uses SD-JWT credentials, did:key identities, and challenge-response authentication instead of passwords.

## 📁Structure

```bash
browser-extension/
├── public/
├── src/
│   ├── components/
│   ├── models/
│   ├── pages/
│   ├── providers/
│   ├── styles/
│   ├── utils/
│   ├── ...
│   └── API.tsx/
├── ...
└── vite.config.ts
```

### [public](./public/)

Contains static assets and configuration files that are served directly without processing during the build step.

`manifest.json` is the core configuration file for the Chrome extension that defines:

- Extension metadata (name, version, description)
- Permissions required (scripting, tabs, activeTab)
- Icon paths for different display contexts
- Extension behavior settings
- Browser action configuration (popup)
- Content security policies

### [src/components/](./src/components/)

Contains the core reusable UI components that form the foundation of the EduWallet Chrome extension interface.

### [src/models/](./src/models/)

Contains TypeScript definitions for the core data structures used throughout the EduWallet application.

### [src/pages/](./src/pages/)

Contains the main views of the EduWallet Chrome extension, each representing a different screen in the application flow.

### [src/providers/](./src/providers/)

Implements the application state management using React Context API. These providers create data contexts that can be accessed throughout the application hierarchy.

### [src/styles/](./src/styles/)

Contains CSS files that define the visual appearance of the EduWallet extension's components and pages. Each file corresponds to a specific component or page, following a modular approach to styling.

### [src/utils/](./src/utils/)

Contains utility functions and configurations that power the core blockchain interactions and data transformations within the EduWallet extension.

### [src/API.tsx](./src/API.tsx)

Serves as the interface layer between the EduWallet extension's UI components and the blockchain smart contracts. It abstracts complex blockchain interactions into simple, functional API calls

### [vite.config.ts](vite.config.ts)

Configures the build process for the EduWallet Chrome extension using Vite as the build tool.
**Key plugins:**

- Compression Plugin (*viteCompression*): Compresses the output files using the Brotli algorithm to reduce the extension's size.
- Visualizer Plugin (*visualizer*): Generates a visual representation of the bundle size in `dist/stats.html`.

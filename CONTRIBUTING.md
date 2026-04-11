# Contributing to Drive Pulse

Thank you for your interest in helping improve **Drive Pulse**! We welcome all contributions, from bug reports to new features.

## 🛠️ Local Development Setup

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/drive-pulse.git
   cd drive-pulse
   ```
3. **Install dependencies** using `uv`:
   ```bash
   uv sync
   ```
4. **Setup your Credentials:** Follow the instructions in the [README.md](README.md) to add your `credentials.json`.

## 🤝 How to Contribute

### 1. Create a Branch
Always create a new branch for your work:
```bash
git checkout -b feat/my-new-feature
```

### 2. Linting
We use **Ruff** for Python linting. Before submitting your PR, please run:
```bash
uv run ruff check .
```

### 3. Submit a Pull Request
- Push your branch to your fork.
- Open a Pull Request against our `main` branch.
- Clearly describe your changes and why they are needed.

## 🔒 Security
If you find a security vulnerability, please do **not** open a public issue. Instead, contact the maintainer directly.

---
*Note: Acknowledgment (Safe-ing) features are currently restricted to owned files only.*

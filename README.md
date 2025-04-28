# ThreeWood

A PS1-style randomly generated golf game built with Three.js.

![ThreeWood Screenshot](screenshot.png) *(Add a screenshot once available)*

## About

ThreeWood is a nostalgic throwback to classic PlayStation 1 era golf games, featuring procedurally generated courses, low-poly graphics, and PS1-inspired visual effects. Navigate challenging courses, improve your score, and unlock new features as you play.

## Features

- PS1-style low-poly graphics with authentic rendering techniques
- Procedurally generated golf courses ensuring unique gameplay
- Physics-based golf mechanics
- Multiple game modes including practice, tournament and challenges
- Retro-inspired UI and sound design

## Installation

### Prerequisites

- Node.js (v14 or newer)
- npm or yarn

### Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/threeWood.git
   cd threeWood
   ```

2. Install dependencies:
   ```
   npm install
   ```
   or
   ```
   yarn install
   ```

3. Start the development server:
   ```
   npm run dev
   ```
   or
   ```
   yarn dev
   ```

4. Open your browser and navigate to `http://localhost:5173` (or the port shown in your terminal)

## Development

See the `game_plan.md` file for a detailed development roadmap and task breakdown.

### Project Structure

```
threeWood/
├── index.html          # Main HTML file
├── main.js             # Entry point for the application
├── styles.css          # Global styles
├── public/             # Static assets
└── src/                # Source code (to be implemented)
    ├── terrain.js      # Terrain generation system
    ├── ball.js         # Golf ball physics
    ├── camera.js       # Camera controls
    ├── gameState.js    # Game state management
    └── ui.js           # User interface components
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by classic PS1 golf games
- Built with Three.js 
class FPSCounter {
    constructor() {
        this.fpsElement = document.createElement('div');
        this.fpsElement.style.position = 'absolute';
        this.fpsElement.style.top = '10px';
        this.fpsElement.style.left = '10px';
        this.fpsElement.style.color = 'white';
        this.fpsElement.style.fontFamily = 'monospace';
        this.fpsElement.style.fontSize = '24px';
        this.fpsElement.style.zIndex = '10000';
        document.body.appendChild(this.fpsElement);

        this.frames = 0;
        this.prevTime = performance.now();
    }

    update() {
        this.frames++;
        const time = performance.now();

        if (time >= this.prevTime + 1000) {
            this.fpsElement.textContent = `FPS: ${Math.round((this.frames * 1000) / (time - this.prevTime))}`;
            this.frames = 0;
            this.prevTime = time;
        }
    }
}

export { FPSCounter };
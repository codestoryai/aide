class AideAgentSessionProvider {
    constructor() {
        this.currentInputTokens = 0;
        this.eventEmitter = new EventTarget();
    }

    updateInputTokens(tokens) {
        this.currentInputTokens = tokens;
        const event = new CustomEvent('aideInputTokensUpdate', {
            detail: { tokens: this.currentInputTokens }
        });
        this.eventEmitter.dispatchEvent(event);
    }

    addEventListener(eventName, handler) {
        this.eventEmitter.addEventListener(eventName, handler);
    }

    removeEventListener(eventName, handler) {
        this.eventEmitter.removeEventListener(eventName, handler);
    }
}

export default AideAgentSessionProvider;
/**
 * RSVP Reader - Sound Manager Module
 * Web Audio API based ambient sound generator.
 * Generates procedural white noise, rain, wind, and fire sounds.
 */

import { CONFIG } from './config.js';
import { State } from './state-manager.js';
import { EventBus, Events } from './event-bus.js';

/**
 * @typedef {'none'|'whitenoise'|'rain'|'wind'|'fire'} SoundType
 */

/**
 * Sound Manager Class
 * Handles ambient sound generation using Web Audio API.
 */
class SoundManagerClass {
    constructor() {
        /** @type {AudioContext|null} */
        this._audioContext = null;
        
        /** @type {GainNode|null} */
        this._masterGain = null;
        
        /** @type {AudioNode|null} */
        this._currentSource = null;
        
        /** @type {SoundType} */
        this._activeSound = 'none';
        
        /** @type {number} 0-100 */
        this._volume = 30;
        
        /** @type {boolean} */
        this._initialized = false;
        
        /** @type {number|null} */
        this._suspendTimer = null;
        
        /** @type {function[]} Unsubscribe functions for cleanup */
        this._unsubscribers = [];
        
        /** @type {number|null} Fire pop interval ID */
        this._firePopInterval = null;
        
        // Noise buffer for procedural sounds
        /** @type {AudioBuffer|null} */
        this._noiseBuffer = null;
        
        // Configuration
        /** @type {number} Noise buffer duration in seconds (longer = less audible loop) */
        this._noiseBufferDuration = 4;
    }

    /**
     * Initialize the audio context
     * Must be called from a user interaction (click/touch) due to browser policies.
     * @returns {boolean} True if initialization succeeded
     */
    init() {
        if (this._initialized) {
            return true;
        }
        
        try {
            // Create audio context
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                console.warn('SoundManager: Web Audio API not supported');
                return false;
            }
            
            this._audioContext = new AudioContextClass();
            
            // Create master gain node
            this._masterGain = this._audioContext.createGain();
            this._masterGain.connect(this._audioContext.destination);
            
            // Set initial volume with validation
            const storedVolume = State.get('soundVolume');
            this._volume = (typeof storedVolume === 'number' && !isNaN(storedVolume)) 
                ? Math.max(0, Math.min(100, storedVolume)) 
                : 30;
            this._setGain(this._volume);
            
            // Generate noise buffer for procedural sounds
            this._generateNoiseBuffer();
            
            this._initialized = true;
            
            // Subscribe to state changes and store unsubscribers for cleanup
            this._unsubscribers.push(
                State.subscribe('soundVolume', (vol) => this.setVolume(vol)),
                State.subscribe('activeSound', (sound) => this.play(sound))
            );
            
            return true;
        } catch (e) {
            console.error('SoundManager: Failed to initialize:', e);
            return false;
        }
    }

    /**
     * Generate a noise buffer for procedural sound generation
     * Uses longer buffer duration to minimize audible looping patterns
     * @private
     */
    _generateNoiseBuffer() {
        if (!this._audioContext) {
            console.error('SoundManager: Cannot generate noise buffer - no audio context');
            return;
        }
        
        // Use configurable duration (default 4 seconds for less audible loop)
        const bufferSize = Math.floor(this._audioContext.sampleRate * this._noiseBufferDuration);
        
        try {
            this._noiseBuffer = this._audioContext.createBuffer(
                1, // mono
                bufferSize,
                this._audioContext.sampleRate
            );
            
            const data = this._noiseBuffer.getChannelData(0);
            
            // Generate white noise with slight smoothing to reduce harshness
            let lastValue = 0;
            for (let i = 0; i < bufferSize; i++) {
                // Mix random with previous value for slightly smoother noise
                const random = Math.random() * 2 - 1;
                data[i] = random * 0.8 + lastValue * 0.2;
                lastValue = data[i];
            }
        } catch (e) {
            console.error('SoundManager: Failed to generate noise buffer:', e);
        }
    }

    /**
     * Resume audio context if suspended
     * @returns {Promise<void>}
     */
    async resume() {
        if (this._audioContext && this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
        }
        
        // Clear any pending suspend timer
        if (this._suspendTimer) {
            clearTimeout(this._suspendTimer);
            this._suspendTimer = null;
        }
    }

    /**
     * Play a sound type
     * @param {SoundType} soundType - Type of sound to play
     * @returns {boolean} True if sound started
     */
    play(soundType) {
        // Validate soundType
        if (!soundType || typeof soundType !== 'string') {
            console.warn('SoundManager: play() requires a valid sound type');
            return false;
        }
        
        // Validate sound type is in allowed list
        const validSounds = CONFIG.SOUNDS || ['none', 'whitenoise', 'rain', 'wind', 'fire'];
        if (!validSounds.includes(soundType)) {
            console.warn(`SoundManager: Unknown sound type "${soundType}"`);
            return false;
        }
        
        // Skip if already playing this sound (prevents subscription loop)
        if (soundType === this._activeSound) {
            return true;
        }
        
        if (!this._initialized) {
            if (!this.init()) {
                return false;
            }
        }
        
        // Stop current sound
        this.stop();
        
        if (soundType === 'none') {
            this._activeSound = 'none';
            State.set('activeSound', 'none', true);
            this._scheduleSuspend();
            return true;
        }
        
        // Resume context if needed
        this.resume();
        
        // Create sound based on type
        try {
            switch (soundType) {
                case 'whitenoise':
                    this._createWhiteNoise();
                    break;
                case 'rain':
                    this._createRain();
                    break;
                case 'wind':
                    this._createWind();
                    break;
                case 'fire':
                    this._createFire();
                    break;
                default:
                    // Should not reach here due to validation above
                    console.warn(`SoundManager: Unknown sound type "${soundType}"`);
                    return false;
            }
            
            this._activeSound = soundType;
            State.set('activeSound', soundType, true);
            
            EventBus.emit(Events.SOUND_PLAY, { soundType });
            
            return true;
        } catch (e) {
            console.error('SoundManager: Failed to create sound:', e);
            return false;
        }
    }

    /**
     * Stop the current sound
     */
    stop() {
        // Clear fire pop interval if running
        if (this._firePopInterval) {
            clearInterval(this._firePopInterval);
            this._firePopInterval = null;
        }
        
        if (this._currentSource) {
            try {
                this._currentSource.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
            this._currentSource = null;
        }
        
        EventBus.emit(Events.SOUND_STOP);
    }

    /**
     * Set volume level
     * @param {number} volume - Volume 0-100
     * @returns {boolean} True if volume was set
     */
    setVolume(volume) {
        // Validate volume is a number
        if (typeof volume !== 'number' || isNaN(volume)) {
            console.warn('SoundManager: setVolume requires a valid number');
            return false;
        }
        
        this._volume = Math.max(0, Math.min(100, Math.round(volume)));
        this._setGain(this._volume);
        
        State.set('soundVolume', this._volume, true);
        EventBus.emit(Events.SOUND_VOLUME_CHANGE, { volume: this._volume });
        return true;
    }

    /**
     * Get current volume
     * @returns {number} Volume 0-100
     */
    getVolume() {
        return this._volume;
    }

    /**
     * Get active sound type
     * @returns {SoundType}
     */
    getActiveSound() {
        return this._activeSound;
    }

    /**
     * Check if a sound is playing
     * @returns {boolean}
     */
    isPlaying() {
        return this._activeSound !== 'none' && this._currentSource !== null;
    }

    /**
     * Get available sound types
     * @returns {SoundType[]}
     */
    getSoundTypes() {
        return [...CONFIG.SOUNDS];
    }

    /**
     * Toggle sound on/off
     * @param {SoundType} [soundType] - Sound to toggle to (defaults to last or whitenoise)
     * @returns {boolean} New playing state
     */
    toggle(soundType) {
        if (this.isPlaying()) {
            this.play('none');
            return false;
        } else {
            const sound = soundType || (this._activeSound !== 'none' ? this._activeSound : 'whitenoise');
            this.play(sound);
            return true;
        }
    }

    /**
     * Cycle to next sound type
     * @returns {SoundType} New sound type
     */
    cycleSound() {
        const sounds = CONFIG.SOUNDS;
        const currentIndex = sounds.indexOf(this._activeSound);
        const nextIndex = (currentIndex + 1) % sounds.length;
        const nextSound = sounds[nextIndex];
        
        this.play(nextSound);
        return nextSound;
    }

    // ============================================
    // SOUND GENERATORS
    // ============================================

    /**
     * Create white noise with gentle filtering for a softer sound
     * More comfortable for long listening sessions
     * @private
     */
    _createWhiteNoise() {
        const ctx = this._audioContext;
        const nodes = [];
        
        const source = ctx.createBufferSource();
        source.buffer = this._noiseBuffer;
        source.loop = true;
        nodes.push(source);
        
        // Gentle lowpass to soften harsh high frequencies
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 8000; // Cut harsh highs above 8kHz
        lowpass.Q.value = 0.5;
        nodes.push(lowpass);
        
        // Slight high-shelf reduction for more comfort
        const highShelf = ctx.createBiquadFilter();
        highShelf.type = 'highshelf';
        highShelf.frequency.value = 4000;
        highShelf.gain.value = -3; // Reduce high frequencies by 3dB
        nodes.push(highShelf);
        
        // Master gain for this sound
        const gain = ctx.createGain();
        gain.gain.value = 0.7;
        nodes.push(gain);
        
        source.connect(lowpass);
        lowpass.connect(highShelf);
        highShelf.connect(gain);
        gain.connect(this._masterGain);
        
        source.start();
        
        this._currentSource = {
            disconnect: () => {
                try { source.stop(); } catch(e) {}
                nodes.forEach(n => {
                    try { n.disconnect(); } catch(e) {}
                });
            }
        };
    }

    /**
     * Create rain sound (multi-layered: steady rain, individual drops, distant rumble)
     * @private
     */
    _createRain() {
        const ctx = this._audioContext;
        const nodes = [];
        
        // === LAYER 1: Steady rain (pink-ish noise) ===
        const rainNoise = ctx.createBufferSource();
        rainNoise.buffer = this._noiseBuffer;
        rainNoise.loop = true;
        nodes.push(rainNoise);
        
        // Shape the noise to sound like rain on a surface
        const rainFilter = ctx.createBiquadFilter();
        rainFilter.type = 'bandpass';
        rainFilter.frequency.value = 2500;
        rainFilter.Q.value = 0.3;
        nodes.push(rainFilter);
        
        const rainHighpass = ctx.createBiquadFilter();
        rainHighpass.type = 'highpass';
        rainHighpass.frequency.value = 800;
        nodes.push(rainHighpass);
        
        // Gentle variation in intensity
        const rainLfo = ctx.createOscillator();
        rainLfo.frequency.value = 0.15;
        const rainLfoGain = ctx.createGain();
        rainLfoGain.gain.value = 400;
        rainLfo.connect(rainLfoGain);
        rainLfoGain.connect(rainFilter.frequency);
        nodes.push(rainLfo, rainLfoGain);
        
        const rainGain = ctx.createGain();
        rainGain.gain.value = 0.5;
        nodes.push(rainGain);
        
        rainNoise.connect(rainFilter);
        rainFilter.connect(rainHighpass);
        rainHighpass.connect(rainGain);
        
        // === LAYER 2: Brighter droplet layer ===
        const dropNoise = ctx.createBufferSource();
        dropNoise.buffer = this._noiseBuffer;
        dropNoise.loop = true;
        nodes.push(dropNoise);
        
        const dropFilter = ctx.createBiquadFilter();
        dropFilter.type = 'highpass';
        dropFilter.frequency.value = 5000;
        nodes.push(dropFilter);
        
        // Faster modulation for droplet texture
        const dropLfo = ctx.createOscillator();
        dropLfo.frequency.value = 2.3;
        const dropLfoGain = ctx.createGain();
        dropLfoGain.gain.value = 1500;
        dropLfo.connect(dropLfoGain);
        dropLfoGain.connect(dropFilter.frequency);
        nodes.push(dropLfo, dropLfoGain);
        
        const dropGain = ctx.createGain();
        dropGain.gain.value = 0.12;
        nodes.push(dropGain);
        
        dropNoise.connect(dropFilter);
        dropFilter.connect(dropGain);
        
        // === LAYER 3: Low rumble (distant thunder/heavy rain) ===
        const rumbleNoise = ctx.createBufferSource();
        rumbleNoise.buffer = this._noiseBuffer;
        rumbleNoise.loop = true;
        nodes.push(rumbleNoise);
        
        const rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 200;
        rumbleFilter.Q.value = 0.7;
        nodes.push(rumbleFilter);
        
        // Very slow modulation
        const rumbleLfo = ctx.createOscillator();
        rumbleLfo.frequency.value = 0.05;
        const rumbleLfoGain = ctx.createGain();
        rumbleLfoGain.gain.value = 80;
        rumbleLfo.connect(rumbleLfoGain);
        rumbleLfoGain.connect(rumbleFilter.frequency);
        nodes.push(rumbleLfo, rumbleLfoGain);
        
        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.25;
        nodes.push(rumbleGain);
        
        rumbleNoise.connect(rumbleFilter);
        rumbleFilter.connect(rumbleGain);
        
        // === Master mix ===
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.85;
        nodes.push(masterGain);
        
        rainGain.connect(masterGain);
        dropGain.connect(masterGain);
        rumbleGain.connect(masterGain);
        masterGain.connect(this._masterGain);
        
        // Start all
        rainNoise.start();
        dropNoise.start();
        rumbleNoise.start();
        rainLfo.start();
        dropLfo.start();
        rumbleLfo.start();
        
        this._currentSource = {
            disconnect: () => {
                [rainNoise, dropNoise, rumbleNoise, rainLfo, dropLfo, rumbleLfo].forEach(n => {
                    try { n.stop(); } catch(e) {}
                });
                nodes.forEach(n => {
                    try { n.disconnect(); } catch(e) {}
                });
            }
        };
    }

    /**
     * Create wind sound (organic gusts with multiple layers)
     * @private
     */
    _createWind() {
        const ctx = this._audioContext;
        const nodes = [];
        
        // === LAYER 1: Base wind whoosh ===
        const baseNoise = ctx.createBufferSource();
        baseNoise.buffer = this._noiseBuffer;
        baseNoise.loop = true;
        nodes.push(baseNoise);
        
        const baseLowpass = ctx.createBiquadFilter();
        baseLowpass.type = 'lowpass';
        baseLowpass.frequency.value = 500;
        baseLowpass.Q.value = 1;
        nodes.push(baseLowpass);
        
        // Slow modulation for base wind
        const baseLfo = ctx.createOscillator();
        baseLfo.frequency.value = 0.07;
        const baseLfoGain = ctx.createGain();
        baseLfoGain.gain.value = 200;
        baseLfo.connect(baseLfoGain);
        baseLfoGain.connect(baseLowpass.frequency);
        nodes.push(baseLfo, baseLfoGain);
        
        const baseGain = ctx.createGain();
        baseGain.gain.value = 0.5;
        nodes.push(baseGain);
        
        baseNoise.connect(baseLowpass);
        baseLowpass.connect(baseGain);
        
        // === LAYER 2: Mid howl ===
        const howlNoise = ctx.createBufferSource();
        howlNoise.buffer = this._noiseBuffer;
        howlNoise.loop = true;
        nodes.push(howlNoise);
        
        const howlBandpass = ctx.createBiquadFilter();
        howlBandpass.type = 'bandpass';
        howlBandpass.frequency.value = 300;
        howlBandpass.Q.value = 3; // Resonant for eerie howl
        nodes.push(howlBandpass);
        
        // Multiple LFOs for organic movement
        const howlLfo1 = ctx.createOscillator();
        howlLfo1.frequency.value = 0.13;
        const howlLfo1Gain = ctx.createGain();
        howlLfo1Gain.gain.value = 150;
        howlLfo1.connect(howlLfo1Gain);
        howlLfo1Gain.connect(howlBandpass.frequency);
        nodes.push(howlLfo1, howlLfo1Gain);
        
        const howlLfo2 = ctx.createOscillator();
        howlLfo2.frequency.value = 0.31;
        const howlLfo2Gain = ctx.createGain();
        howlLfo2Gain.gain.value = 80;
        howlLfo2.connect(howlLfo2Gain);
        howlLfo2Gain.connect(howlBandpass.frequency);
        nodes.push(howlLfo2, howlLfo2Gain);
        
        const howlGain = ctx.createGain();
        howlGain.gain.value = 0.3;
        nodes.push(howlGain);
        
        // Volume modulation for gusts
        const gustLfo = ctx.createOscillator();
        gustLfo.frequency.value = 0.09;
        const gustLfoGain = ctx.createGain();
        gustLfoGain.gain.value = 0.2;
        gustLfo.connect(gustLfoGain);
        gustLfoGain.connect(howlGain.gain);
        nodes.push(gustLfo, gustLfoGain);
        
        howlNoise.connect(howlBandpass);
        howlBandpass.connect(howlGain);
        
        // === LAYER 3: High whistle (through gaps) ===
        const whistleNoise = ctx.createBufferSource();
        whistleNoise.buffer = this._noiseBuffer;
        whistleNoise.loop = true;
        nodes.push(whistleNoise);
        
        const whistleFilter = ctx.createBiquadFilter();
        whistleFilter.type = 'bandpass';
        whistleFilter.frequency.value = 2000;
        whistleFilter.Q.value = 8; // Very resonant
        nodes.push(whistleFilter);
        
        const whistleLfo = ctx.createOscillator();
        whistleLfo.frequency.value = 0.2;
        const whistleLfoGain = ctx.createGain();
        whistleLfoGain.gain.value = 800;
        whistleLfo.connect(whistleLfoGain);
        whistleLfoGain.connect(whistleFilter.frequency);
        nodes.push(whistleLfo, whistleLfoGain);
        
        const whistleGain = ctx.createGain();
        whistleGain.gain.value = 0.04;
        nodes.push(whistleGain);
        
        whistleNoise.connect(whistleFilter);
        whistleFilter.connect(whistleGain);
        
        // === Master output ===
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.75;
        nodes.push(masterGain);
        
        baseGain.connect(masterGain);
        howlGain.connect(masterGain);
        whistleGain.connect(masterGain);
        masterGain.connect(this._masterGain);
        
        // Start all
        baseNoise.start();
        howlNoise.start();
        whistleNoise.start();
        baseLfo.start();
        howlLfo1.start();
        howlLfo2.start();
        gustLfo.start();
        whistleLfo.start();
        
        this._currentSource = {
            disconnect: () => {
                [baseNoise, howlNoise, whistleNoise, baseLfo, howlLfo1, howlLfo2, gustLfo, whistleLfo].forEach(n => {
                    try { n.stop(); } catch(e) {}
                });
                nodes.forEach(n => {
                    try { n.disconnect(); } catch(e) {}
                });
            }
        };
    }

    /**
     * Create fire/crackling sound
     * Realistic fire with: base roar, mid crackle, high hiss, and random pops
     * @private
     */
    _createFire() {
        const ctx = this._audioContext;
        const nodes = [];
        
        // === LAYER 1: Deep fire roar (the "whoosh" of flames) ===
        const roarNoise = ctx.createBufferSource();
        roarNoise.buffer = this._noiseBuffer;
        roarNoise.loop = true;
        nodes.push(roarNoise);
        
        const roarFilter = ctx.createBiquadFilter();
        roarFilter.type = 'lowpass';
        roarFilter.frequency.value = 150;
        roarFilter.Q.value = 1;
        nodes.push(roarFilter);
        
        // Slow modulation for flame intensity
        const roarLfo = ctx.createOscillator();
        roarLfo.frequency.value = 0.08;
        const roarLfoGain = ctx.createGain();
        roarLfoGain.gain.value = 50;
        roarLfo.connect(roarLfoGain);
        roarLfoGain.connect(roarFilter.frequency);
        nodes.push(roarLfo, roarLfoGain);
        
        const roarGain = ctx.createGain();
        roarGain.gain.value = 0.6;
        nodes.push(roarGain);
        
        roarNoise.connect(roarFilter);
        roarFilter.connect(roarGain);
        
        // === LAYER 2: Mid-frequency crackle ===
        const crackleNoise = ctx.createBufferSource();
        crackleNoise.buffer = this._noiseBuffer;
        crackleNoise.loop = true;
        nodes.push(crackleNoise);
        
        const crackleBandpass = ctx.createBiquadFilter();
        crackleBandpass.type = 'bandpass';
        crackleBandpass.frequency.value = 800;
        crackleBandpass.Q.value = 0.8;
        nodes.push(crackleBandpass);
        
        // Irregular modulation using multiple LFOs
        const crackleLfo1 = ctx.createOscillator();
        crackleLfo1.frequency.value = 3.7; // Prime-ish frequency for less repetition
        const crackleLfo1Gain = ctx.createGain();
        crackleLfo1Gain.gain.value = 400;
        crackleLfo1.connect(crackleLfo1Gain);
        crackleLfo1Gain.connect(crackleBandpass.frequency);
        nodes.push(crackleLfo1, crackleLfo1Gain);
        
        const crackleLfo2 = ctx.createOscillator();
        crackleLfo2.frequency.value = 5.3;
        const crackleLfo2Gain = ctx.createGain();
        crackleLfo2Gain.gain.value = 200;
        crackleLfo2.connect(crackleLfo2Gain);
        crackleLfo2Gain.connect(crackleBandpass.frequency);
        nodes.push(crackleLfo2, crackleLfo2Gain);
        
        const crackleGain = ctx.createGain();
        crackleGain.gain.value = 0.35;
        nodes.push(crackleGain);
        
        crackleNoise.connect(crackleBandpass);
        crackleBandpass.connect(crackleGain);
        
        // === LAYER 3: High frequency sizzle/hiss ===
        const hissNoise = ctx.createBufferSource();
        hissNoise.buffer = this._noiseBuffer;
        hissNoise.loop = true;
        nodes.push(hissNoise);
        
        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'highpass';
        hissFilter.frequency.value = 4000;
        nodes.push(hissFilter);
        
        const hissGain = ctx.createGain();
        hissGain.gain.value = 0.08;
        nodes.push(hissGain);
        
        // Modulate hiss for variation
        const hissLfo = ctx.createOscillator();
        hissLfo.frequency.value = 0.5;
        const hissLfoGain = ctx.createGain();
        hissLfoGain.gain.value = 0.04;
        hissLfo.connect(hissLfoGain);
        hissLfoGain.connect(hissGain.gain);
        nodes.push(hissLfo, hissLfoGain);
        
        hissNoise.connect(hissFilter);
        hissFilter.connect(hissGain);
        
        // === LAYER 4: Random pops (characteristic of real fire) ===
        // Create a gain node for pops that connects to compressor
        const popGain = ctx.createGain();
        popGain.gain.value = 0.6;
        nodes.push(popGain);
        
        // === Master output with gentle compression ===
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 10;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.01;
        compressor.release.value = 0.1;
        nodes.push(compressor);
        
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.9;
        nodes.push(masterGain);
        
        // Connect all layers to compressor
        roarGain.connect(compressor);
        crackleGain.connect(compressor);
        hissGain.connect(compressor);
        popGain.connect(compressor);
        compressor.connect(masterGain);
        masterGain.connect(this._masterGain);
        
        // Start all continuous sources
        roarNoise.start();
        crackleNoise.start();
        hissNoise.start();
        roarLfo.start();
        crackleLfo1.start();
        crackleLfo2.start();
        hissLfo.start();
        
        // === Random pop generator ===
        // Create pops at random intervals for realistic fire sound
        const createPop = () => {
            if (!this._audioContext || this._activeSound !== 'fire') return;
            
            try {
                // Random characteristics for each pop
                const popFreq = 1000 + Math.random() * 3000; // 1-4kHz
                const popDuration = 0.02 + Math.random() * 0.05; // 20-70ms
                const popVolume = 0.1 + Math.random() * 0.3; // Variable volume
                
                // Create a short noise burst
                const popBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * popDuration), ctx.sampleRate);
                const popData = popBuffer.getChannelData(0);
                
                // Generate pop with exponential decay envelope
                for (let i = 0; i < popData.length; i++) {
                    const envelope = Math.exp(-i / (popData.length * 0.2)); // Fast decay
                    popData[i] = (Math.random() * 2 - 1) * envelope;
                }
                
                const popSource = ctx.createBufferSource();
                popSource.buffer = popBuffer;
                
                // Bandpass filter for pop character
                const popFilter = ctx.createBiquadFilter();
                popFilter.type = 'bandpass';
                popFilter.frequency.value = popFreq;
                popFilter.Q.value = 2 + Math.random() * 4;
                
                const popAmp = ctx.createGain();
                popAmp.gain.value = popVolume;
                
                popSource.connect(popFilter);
                popFilter.connect(popAmp);
                popAmp.connect(popGain);
                
                popSource.start();
                
                // Clean up after pop finishes
                popSource.onended = () => {
                    try {
                        popSource.disconnect();
                        popFilter.disconnect();
                        popAmp.disconnect();
                    } catch (e) {}
                };
            } catch (e) {
                // Ignore pop creation errors
            }
        };
        
        // Schedule random pops (2-8 per second on average)
        this._firePopInterval = setInterval(() => {
            // Random chance to create 0-3 pops
            const numPops = Math.floor(Math.random() * 4);
            for (let i = 0; i < numPops; i++) {
                // Stagger pops slightly
                setTimeout(createPop, Math.random() * 200);
            }
        }, 250);
        
        this._currentSource = {
            disconnect: () => {
                // Stop all oscillators and sources
                [roarNoise, crackleNoise, hissNoise, roarLfo, crackleLfo1, crackleLfo2, hissLfo].forEach(n => {
                    try { n.stop(); } catch(e) {}
                });
                // Disconnect all nodes
                nodes.forEach(n => {
                    try { n.disconnect(); } catch(e) {}
                });
            }
        };
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    /**
     * Set gain value from volume percentage
     * @private
     * @param {number} volume - 0-100
     */
    _setGain(volume) {
        if (this._masterGain) {
            // Use exponential curve for more natural volume
            const gain = Math.pow(volume / 100, 2) * 0.5;
            this._masterGain.gain.setValueAtTime(gain, this._audioContext.currentTime);
        }
    }

    /**
     * Schedule audio context suspension to save resources
     * @private
     */
    _scheduleSuspend() {
        if (this._suspendTimer) {
            clearTimeout(this._suspendTimer);
        }
        
        this._suspendTimer = setTimeout(() => {
            if (this._audioContext && this._activeSound === 'none') {
                this._audioContext.suspend();
            }
        }, CONFIG.TIMING.AUDIO_SUSPEND_DELAY_MS);
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.stop();
        
        // Clear suspend timer
        if (this._suspendTimer) {
            clearTimeout(this._suspendTimer);
            this._suspendTimer = null;
        }
        
        // Clear fire pop interval
        if (this._firePopInterval) {
            clearInterval(this._firePopInterval);
            this._firePopInterval = null;
        }
        
        // Unsubscribe from state changes
        this._unsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') {
                unsub();
            }
        });
        this._unsubscribers = [];
        
        // Close audio context
        if (this._audioContext) {
            try {
                this._audioContext.close();
            } catch (e) {
                // Ignore close errors
            }
            this._audioContext = null;
        }
        
        // Reset state
        this._masterGain = null;
        this._noiseBuffer = null;
        this._activeSound = 'none';
        this._volume = 30;
        this._initialized = false;
    }
}

// Export singleton
export const SoundManager = new SoundManagerClass();

// Also export class for testing
export { SoundManagerClass };

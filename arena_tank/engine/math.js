// Math utility functions

const MathUtils = {
    // Calculate distance between two points
    distance: (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    },

    // Calculate angle between two points
    angle: (x1, y1, x2, y2) => {
        return Math.atan2(y2 - y1, x2 - x1);
    },

    // Clamp a value between min and max
    clamp: (value, min, max) => {
        return Math.max(min, Math.min(max, value));
    },

    // Linear interpolation
    lerp: (a, b, t) => {
        return a + (b - a) * t;
    },

    // Random number between min and max
    random: (min, max) => {
        return Math.random() * (max - min) + min;
    },

    // Normalize angle to -PI to PI
    normalizeAngle: (angle) => {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }
};

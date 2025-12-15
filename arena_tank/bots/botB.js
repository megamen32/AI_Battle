class BotB {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.velocityX = 0;
        this.velocityY = 0;
        this.angle = Math.PI;
        this.radius = 10;
        this.color = '#0000ff';
        this.health = 100;
        this.maxHealth = 100;
        this.speed = 120;
        this.rotationSpeed = Math.PI * 1.8;
        this.visionRange = 220;
        this.stateTimer = 0;
    }

    update(deltaTime, world, allBots) {
        this.stateTimer += deltaTime;

        // Find nearest enemy
        let nearestEnemy = null;
        let minDistance = this.visionRange;

        allBots.forEach(bot => {
            if (bot !== this) {
                const dist = MathUtils.distance(this.x, this.y, bot.x, bot.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestEnemy = bot;
                }
            }
        });

        if (nearestEnemy) {
            // More aggressive turning
            const targetAngle = MathUtils.angle(this.x, this.y, nearestEnemy.x, nearestEnemy.y);
            const angleDiff = MathUtils.normalizeAngle(targetAngle - this.angle);
            this.angle += MathUtils.clamp(angleDiff, -this.rotationSpeed * deltaTime, this.rotationSpeed * deltaTime);

            // Dash attack
            this.velocityX = Math.cos(this.angle) * this.speed * 1.2;
            this.velocityY = Math.sin(this.angle) * this.speed * 1.2;
        } else {
            // Circular patrol pattern
            const patrolAngle = this.stateTimer * 0.5;
            this.angle = patrolAngle;
            this.velocityX = Math.cos(this.angle) * this.speed * 0.6;
            this.velocityY = Math.sin(this.angle) * this.speed * 0.6;
        }
    }

    onCollision(other) {
        this.health -= 12;
        // More aggressive bounce
        const angle = MathUtils.angle(other.x, other.y, this.x, this.y);
        this.velocityX = Math.cos(angle) * 250;
        this.velocityY = Math.sin(angle) * 250;
    }
}

class World {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.entities = [];
    }

    addEntity(entity) {
        this.entities.push(entity);
    }

    removeEntity(entity) {
        const index = this.entities.indexOf(entity);
        if (index > -1) {
            this.entities.splice(index, 1);
        }
    }

    update(deltaTime) {
        // Apply physics to all entities
        this.entities.forEach(entity => {
            // Apply friction
            if (entity.velocityX !== undefined) {
                entity.velocityX *= 0.95;
                entity.velocityY *= 0.95;
            }

            // Update position
            if (entity.velocityX !== undefined) {
                entity.x += entity.velocityX * deltaTime;
                entity.y += entity.velocityY * deltaTime;
            }

            // Bounce off walls
            if (entity.radius !== undefined) {
                if (entity.x - entity.radius < 0) {
                    entity.x = entity.radius;
                    if (entity.velocityX !== undefined) entity.velocityX *= -0.8;
                }
                if (entity.x + entity.radius > this.width) {
                    entity.x = this.width - entity.radius;
                    if (entity.velocityX !== undefined) entity.velocityX *= -0.8;
                }
                if (entity.y - entity.radius < 0) {
                    entity.y = entity.radius;
                    if (entity.velocityY !== undefined) entity.velocityY *= -0.8;
                }
                if (entity.y + entity.radius > this.height) {
                    entity.y = this.height - entity.radius;
                    if (entity.velocityY !== undefined) entity.velocityY *= -0.8;
                }
            }
        });
    }

    getNearbyEntities(x, y, radius) {
        return this.entities.filter(entity => {
            const dx = entity.x - x;
            const dy = entity.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance < radius;
        });
    }
}

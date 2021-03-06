const CellBehavior = require('./CellBehavior');
const Config = require('../../Config');
const Item = require('../Item');

/**
 * Class representing a move behavior.
 * @extends CellBehavior
 */
class MoveBehavior extends CellBehavior {
  /**
   * @param {Cell} performer
   */
  constructor(performer) {
    super(performer);
    this.destination = null;

    performer.addUpdateListener((world, cell) => {
      if (this.destination) {
        const dest = this.destination.asVector2();
        const cur = cell.getPosition().asVector2();

        const magnitude = cell.getState().speed || Config.CELL_DEFAULT_SPEED;

        const delta = dest.subtract(cur);
        if (delta.length() === 0) {
          this.destination = null;
          return;
        }

        const speed = delta.normalize().multiply(magnitude);

        let speedX;
        if (delta.x > 0) {
          speedX = Math.min(delta.x, speed.x);
        } else {
          speedX = Math.max(delta.x, speed.x);
        }

        let speedY;
        if (delta.y > 0) {
          speedY = Math.min(delta.y, speed.y);
        } else {
          speedY = Math.max(delta.y, speed.y);
        }
        cell.setX(cur.x + speedX);
        cell.setY(cur.y + speedY);
      }

      world
        .getAll()
        .filter(v => v instanceof Item
          && v.calculateDistance(cell) < Config.ITEM_PICKUP_DISTANCE)
        .forEach(v => v.collectedBy(cell));
    });
  }

  /**
   * @param {Vector2} destination
   */
  move(destination) {
    this.destination = destination;
  }
}

module.exports = MoveBehavior;

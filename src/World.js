const Cell = require('./entity/Cell');
const Entity = require('./entity/Entity');
const Item = require('./entity/Item');
const ProducerCell = require('./entity/ProducerCell');
const ProductionCell = require('./entity/ProductionCell');
const Vector2 = require('./math/Vector2');
const Config = require('./Config');
const Utils = require('./Utils');

/** Class representing a world. */
class World {
  /**
   * @param {Room} room
   */
  constructor(room) {
    /** @type {Room} */
    this.room = room;
    this.width = 1000;
    this.height = 1000;
    this.timeout = null;
    this.lastEntityId = 0; // DO NOT USE THIS VARIABLE!
    this.entities = [];
  }

  /**
   * @param {Entity} entity
   */
  add(entity) {
    if (entity.hasId()) {
      entity.setId(this.lastEntityId);
      this.lastEntityId += 1;
      this.entities.push(entity);
    } else {
      throw new Error('ID allocated entity was found');
    }
  }

  /**
   * @param {Cell} cell
   */
  attachCellListener(cell) {
    cell.addDamagedListener((attackerCell, victimCell) => {
      const attackerCellId = attackerCell.getId();
      const victimCellId = victimCell.getId();
      attackerCell.getOwner().getSocket().emit('cell attack', attackerCellId, victimCellId);
      victimCell.getOwner().getSocket().emit('cell damaged', attackerCellId, victimCellId);
    });
    cell.addKilledListener((murderCell, victimCell) => {
      const victimCellId = victimCell.getId();
      if (murderCell) {
        const murderCellId = murderCell.getId();
        const murderCellOwner = murderCell.getOwner();
        murderCellOwner.addNutrients(Config.CELL_NUTRIENTS);
        murderCellOwner.getSocket().emit('cell kill', murderCellId, victimCellId);
        victimCell.getOwner().getSocket().emit('cell killed', murderCellId, victimCellId);
      } else {
        victimCell.getOwner().getSocket().emit('cell killed', -1, victimCellId);
      }
      this.remove(victimCell);
    });
  }

  /**
   * @param {string} eventName
   * @param {Object} data
   */
  broadcastGlobally(eventName, data) {
    this.room.broadcastGlobally(eventName, data);
  }

  /**
   * @param {Vector2} position
   * @param {string} eventName
   * @param data
   */
  broadcastNearby(position, eventName, data) {
    this.room.broadcastNearby(position, eventName, data);
  }

  /** */
  close() {
    clearInterval(this.timeout);
    this.timeout = null;
  }

  /**
   * @param {(Entity|number)} entity
   * @returns {?Entity}
   */
  find(entity) {
    let id;
    if (typeof entity === 'number') {
      id = entity;
    } else if (entity instanceof Entity) {
      id = entity.getId();
    } else {
      throw new TypeError('invalid argument');
    }
    return this.entities.find(element => element.getId() === id) || null;
  }

  /**
   * @returns {Array.<Entity>}
   */
  getAll() {
    return this.entities;
  }

  /**
   * @param {number} id
   * @returns {boolean}
   */
  has(id) {
    return this.entities.findIndex(entity => entity.getId() === id) >= 0;
  }

  /**
   * @returns {boolean}
   */
  isOpen() {
    return Boolean(this.timeout);
  }

  /** */
  open() {
    this.timeout = setInterval(() => {
      const { entities } = this;
      entities.forEach(entity => entity.update(this));
      const cellInfoForBroadcast = {};
      const cells = entities.filter(entity => entity instanceof Cell);
      cells.forEach((cell) => {
        const owner = cell.getOwner();
        const ownerId = owner.getId();
        const cellData = [cell.getId(), cell.getX(), cell.getY()];
        if (ownerId in cellInfoForBroadcast) {
          cellInfoForBroadcast[ownerId].data.push(cellData);
        } else {
          cellInfoForBroadcast[ownerId] = {
            player: owner,
            data: [cellData],
          };
        }
        cells.filter(element => element.getOwner().getId() !== ownerId
          && element.calculateDistance(cell) <= Config.RENDER_MAX_DISTANCE)
          .forEach((element) => {
            const elementData = [element.getId(), element.getX(), element.getY()];
            cellInfoForBroadcast[ownerId].data.push(elementData);
          });
      });
      for (const { player, data } of cellInfoForBroadcast) {
        player.getSocket().emit('cell position', data);
      }
      const itemDataForBroadcast = [];
      const items = entities.filter(entity => entity instanceof Item);
      items.forEach((item) => {
        itemDataForBroadcast.push([item.getId(), item.getX(), item.getY()]);
      });
      this.broadcastGlobally('item position', itemDataForBroadcast);
    }, 50); // interval: 20ms
    const players = this.room.getPlayers();
    for (let i = 0; i < Config.PLAYERS_PER_ROOM; i += 1) {
      const producerCell = new ProducerCell(
        -1,
        Utils.createRandomVector2(0, 0, this.width, this.height),
        players[i],
        Cell.State.createDefaultState(),
      );
      this.attachCellListener(producerCell);
      this.add(producerCell);
    }
  }

  /**
   * @param {string} eventName
   * @param {Object} data
   */
  receive(eventName, data) {
    switch (eventName) {
      case 'cell create':
        {
          const {
            id, // production cell ID
            amount, // how many produce cells
          } = data;
          const producerCell = this.find(id);
          if (producerCell) {
            const cells = producerCell.performProduce(amount);
            for (const cell of cells) {
              this.attachCellListener(cell);
              this.add(cell);
            }
          }
        }
        break;
      case 'cell move':
        {
          const {
            id, // cell ID
            x, // destination x
            y, // destination y
          } = data;
          const cell = this.find(id);
          if (cell) {
            cell.performMove(new Vector2(x, y));
          }
        }
        break;
      case 'cell info':
        {
          const {
            id, // cell ID
          } = data;
          const cell = this.find(id);
          if (cell) {
            let type = 'cell';
            if (cell instanceof ProducerCell) {
              type = 'producer cell';
            } else if (cell instanceof ProductionCell) {
              type = 'production cell';
            }
            cell.getOwner().emit('cell state', type, cell.getState().toObject());
          } else {
            cell.getOwner().emit('cell state', 'null', 'null');
          }
        }
        break;
      case 'cell dna update':
        {
          const {
            id, // production cell ID
            dnaList, // DNA list
          } = data;
          const producerCell = this.find(id);
          if (producerCell) {
            producerCell.setDnaList(Utils.createDnaListFromNames(dnaList));
          }
        }
        break;
      default:
        throw new Error();
    }
  }

  /**
   * @param {(Entity|number)} entity
   */
  remove(entity) {
    let id;
    if (typeof entity === 'number') {
      id = entity;
    } else if (entity instanceof Entity) {
      id = entity.getId();
    } else {
      throw new TypeError('invalid argument');
    }
    const { entities } = this;
    const index = entities.findIndex(element => element.getId() === id);
    if (index >= 0) {
      entities.splice(index, 1);
    }
  }
}

module.exports = World;

const Cell = require('./entity/Cell');
const Dna = require('./entity/Dna');
const Entity = require('./entity/Entity');
const Nutrient = require('./entity/Nutrient');
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
    if (!entity.hasId()) {
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
      if (attackerCell) {
        this.broadcastNearby(victimCell.getPosition(), 'cell kill', attackerCell.getId(), victimCell.getId());
      } else {
        this.broadcastNearby(victimCell.getPosition(), 'cell kill', -1, victimCell.getId());
      }
    });
    cell.addKilledListener((murderCell, victimCell) => {
      if (murderCell) {
        murderCell.getOwner().addNutrients(Config.CELL_NUTRIENTS);
        this.broadcastNearby(victimCell.getPosition(), 'cell kill', murderCell.getId(), victimCell.getId());
      } else {
        this.broadcastNearby(victimCell.getPosition(), 'cell kill', -1, victimCell.getId());
      }
      this.remove(victimCell);
    });
  }

  /**
   * @param {string} eventName
   * @param {Object} data
   */
  broadcastGlobally(eventName, ...data) {
    this.room.broadcastGlobally(eventName, ...data);
  }

  /**
   * @param {Vector2} position
   * @param {string} eventName
   * @param data
   */
  broadcastNearby(position, eventName, ...data) {
    this.room.broadcastNearby(position, eventName, ...data);
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
        const cellData = { id: cell.getId(), x: cell.getX(), y: cell.getY() };
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
            const elementData = { id: element.getId(), x: element.getX(), y: element.getY() };
            cellInfoForBroadcast[ownerId].data.push(elementData);
          });
      });
      for (const [, { player, data }] of Object.entries(cellInfoForBroadcast)) {
        player.getSocket().emit('cell position', data);
      }
    }, 50); // interval: 20ms

    const players = this.room.getPlayers();
    for (let i = 0; i < Config.PLAYERS_PER_ROOM; i += 1) {
      const player = players[i];
      const producerCell = new ProducerCell(
        -1, // id must be -1 to add to the world
        Utils.createRandomVector2(0, 0, this.width, this.height),
        this,
        player,
        Cell.State.createDefaultState(),
      );
      this.attachCellListener(producerCell);
      this.add(producerCell);
      player.getSocket().emit('cell producer position', {
        id: producerCell.getId(),
        type: 'Producer',
        position: producerCell.getPosition().toArray(),
      });
    }

    const items = [];
    for (let i = 0; i < Config.DEFAULT_NUTRIENT_CREATION; i += 1) {
      const nutrient = new Nutrient(
        -1,
        Utils.createRandomVector2(0, 0, this.width, this.height),
        this,
        Utils.getRandomIntInclusive(Config.MIN_NUTRIENT_AMOUNT, Config.MAX_NUTRIENT_AMOUNT),
      );
      this.add(nutrient);

      items.push({
        type: 'Nutrient',
        id: nutrient.getId(),
        position: [nutrient.getX(), nutrient.getY()],
        attributes: {
          amount: nutrient.getAmount(),
        },
      });
    }

    for (let i = 0; i < Config.DEFAULT_DNA_CREATION; i += 1) {
      const dna = new Dna(
        -1,
        Utils.createRandomVector2(0, 0, this.width, this.height),
        this,
        Dna.Information.createRandomDnaInformation(),
      );
      this.add(dna);

      items.push({
        type: 'DNA',
        id: dna.getId(),
        position: [dna.getX(), dna.getY()],
        attributes: dna.getInformation().toObject(),
      });
    }

    this.broadcastGlobally('item info', items);
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
          if (cell instanceof Cell) {
            cell.performMove(new Vector2(x, y));
          }
        }
        break;
      case 'cell info':
        {
          const {
            player, // requesting player
            idList, // cell ID list
          } = data;
          const infoList = [];
          for (const id of idList) {
            const cell = this.find(id);

            if (cell instanceof Cell) {
              let type = 'Cell';
              if (cell instanceof ProducerCell) {
                type = 'Producer';
              } else if (cell instanceof ProductionCell) {
                type = 'Production';
              }

              if (cell.isVisibleTo(player)) {
                infoList.push({
                  id,
                  type,
                  position: cell.getPosition().toArray(),
                  state: cell.getState().toObject(),
                });
              }
            }
          }

          player.getSocket().emit('cell info', infoList);
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

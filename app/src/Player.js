import AnimationMove from './render/AnimationMove';
import UnitSelection from './utils/UnitSelection';

class Player {
  constructor(game) {
    this.game = game;
    this.cursor = { x: 100, y: 100 };
    this.selectedUnits = new UnitSelection(this.game);
    this.selectStart = null;
    this.nutrients = 0;
    this.dnas = {};

    this.clearSelections();

    this.savedSelections = [];
  }

  get renderer() {
    return this.game.renderer;
  }

  addNutrients(amount) {
    this.nutrients += Math.max(0, amount);
    this.updateNutrients();
  }

  subtractNutrients(amount) {
    this.nutrients -= Math.max(0, amount);
    this.updateNutrients();
  }

  updateNutrients() {
    this.game.store.commit('nutrients');
  }

  findDNA(dna) {
    this.dnas[dna.id] = dna;
    this.game.store.commit('dnaList');
  }

  startSelect() {
    this.selectStart = this.renderer.getRealPosition(this.cursor);
  }

  endSelect() {
    const selectEnd = this.renderer.getRealPosition(this.cursor);
    this.clearSelections();

    this.game.entities.forEach((value) => {
      if (!(
        (selectEnd.x < value.x && value.x < this.selectStart.x)
        || (selectEnd.x > value.x && value.x > this.selectStart.x)
      )) return;

      if (!(
        (selectEnd.y < value.y && value.y < this.selectStart.y)
        || (selectEnd.y > value.y && value.y > this.selectStart.y)
      )) return;

      this.selectedUnits.add(value);
    });

    this.selectStart = null;
  }

  clearSelections() {
    this.selectedUnits.units = [];
  }

  moveUnitsToPosition() {
    if (this.selectedUnits.units.length < 1) return;

    const realPosition = this.renderer.getRealPosition(this.cursor);
    const moveAnimation = new AnimationMove(this.renderer, realPosition.x, realPosition.y);
    this.renderer.addAnimation(moveAnimation);


    this.selectedUnits.units.forEach((unit) => {
      this.game.socket.emit('cell move', {
        id: unit.id,
        x: realPosition.x,
        y: realPosition.y,
      });
    });
  }

  get dnaList() {
    return Object.keys(this.dnas).map(k => this.dnas[k]);
  }
}

export default Player;

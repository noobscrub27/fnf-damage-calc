import {Generation, AbilityName, StatID} from '../data/interface';
import {getItemBoostType, getNaturalGift, getFlingPower, getBerryResistType} from '../items';
import {RawDesc} from '../desc';
import {Field} from '../field';
import {Move} from '../move';
import {Pokemon} from '../pokemon';
import {Result} from '../result';
import {getOrbType} from '../items';
import {
  getModifiedStat,
  getEVDescriptionText,
  getFinalSpeed,
  getMoveEffectiveness,
  checkAirLock,
  checkForecast,
  checkItem,
  checkIntimidate,
  checkDownload,
  checkSillySoda,
  checkMultihitBoost,
  checkSearchEngine,
  checkInflate,
  countBoosts,
  handleFixedDamageMoves,
  isGrounded,
} from './util';
import {toID} from '../util';

export function calculateDPP(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field
) {
  // #region Initial

  checkAirLock(attacker, field);
  checkAirLock(defender, field);
  checkForecast(attacker, field.weather);
  checkForecast(defender, field.weather);
  checkItem(attacker);
  checkItem(defender);
  checkIntimidate(gen, attacker, defender);
  checkIntimidate(gen, defender, attacker);
  checkDownload(attacker, defender);
  checkDownload(defender, attacker);
  checkSearchEngine(defender, attacker);
  checkSearchEngine(attacker, defender);
  checkInflate(attacker);
  checkInflate(defender);
  checkSillySoda(attacker, gen);
  checkSillySoda(defender, gen);
  attacker.stats.spe = getFinalSpeed(gen, attacker, field, field.attackerSide);
  defender.stats.spe = getFinalSpeed(gen, defender, field, field.defenderSide);

  const desc: RawDesc = {
    attackerName: attacker.name,
    moveName: move.name,
    defenderName: defender.name,
  };

  const result = new Result(gen, attacker, defender, move, field, 0, desc);

  if (move.category === 'Status' && !move.named('Nature Power')) {
    return result;
  }

  if (field.defenderSide.isProtected && !move.breaksProtect) {
    desc.isProtected = true;
    return result;
  }

  if (attacker.hasAbility('Mold Breaker')) {
    defender.ability = '' as AbilityName;
    desc.attackerAbility = attacker.ability;
  }

  const isCritical = move.isCrit && !defender.hasAbility('Battle Armor', 'Shell Armor') && !(defender.hasAbility('Pure Heart', 'Shadow Armor') && move.hasType('Shadow'));

  if (move.named('Weather Ball')) {
    move.type =
      field.hasWeather('Sun') ? 'Fire'
        : field.hasWeather('Rain') ? 'Water'
          : field.hasWeather('Sand') ? 'Rock'
            : field.hasWeather('Hail') ? 'Ice'
              : 'Normal';

    desc.weather = field.weather;
    desc.moveType = move.type;
  } else if (move.named('Judgment') && attacker.item && attacker.item.includes('Plate')) {
    move.type = getItemBoostType(attacker.item)!;
  } else if (move.named('Primal Burst') && attacker.item && attacker.item.includes('Orb')) {
    move.type = getOrbType(attacker.item)!;
  } else if (move.named('Natural Gift') && attacker.item && attacker.item.endsWith('Berry')) {
    const gift = getNaturalGift(gen, attacker.item)!;
    move.type = gift.t;
    move.bp = gift.p;
    desc.attackerItem = attacker.item;
    desc.moveBP = move.bp;
    desc.moveType = move.type;
  }

  // so far there are no plans to backport other ate abilities but it doesnt hurt to do things this way just in case
  let hasAteAbilityTypeChange = false;
  let isNormalize = false;
  const noTypeChange = move.named('Struggle');

  if (!noTypeChange) {
    if ((isNormalize = attacker.hasAbility('Normalize'))) {
      move.type = 'Normal';
    }
    if (isNormalize) {
      desc.attackerAbility = attacker.ability;
      hasAteAbilityTypeChange = true;
    }
  }

  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }

  if (attacker.hasAbility('Melody Allegretto') && move.flags.sound) {
    move.priority = 1;
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Stall')) {
    move.priority = -1;
    desc.attackerAbility = attacker.ability;
  }

  const isGhostRevealed = attacker.hasAbility('Scrappy') || field.defenderSide.isForesight;
  const isDarkRevealed = field.defenderSide.isMiracleEye || attacker.hasAbility('Psyche Control');

  const typeEffectivenessPrecedenceRules = [
    'Normal',
    'Fire',
    'Water',
    'Electric',
    'Grass',
    'Ice',
    'Fighting',
    'Poison',
    'Ground',
    'Flying',
    'Psychic',
    'Bug',
    'Rock',
    'Ghost',
    'Dragon',
    'Dark',
    'Steel',
  ];

  let firstDefenderType = defender.types[0];
  let secondDefenderType = defender.types[1];

  if (secondDefenderType && firstDefenderType !== secondDefenderType) {
    const firstTypePrecedence = typeEffectivenessPrecedenceRules.indexOf(firstDefenderType);
    const secondTypePrecedence = typeEffectivenessPrecedenceRules.indexOf(secondDefenderType);

    if (firstTypePrecedence > secondTypePrecedence) {
      [firstDefenderType, secondDefenderType] = [secondDefenderType, firstDefenderType];
    }
  }
  const isBoneMaster = attacker.hasAbility('Bone Master') && !!move.flags.bone;

  let type1Effectiveness =
    getMoveEffectiveness(gen, move, firstDefenderType, isGhostRevealed, isDarkRevealed, field.isGravity, false, isBoneMaster);
  let type2Effectiveness = secondDefenderType
    ? getMoveEffectiveness(gen, move, secondDefenderType, isGhostRevealed, isDarkRevealed, field.isGravity, false, isBoneMaster)
    : 1;

  let typeEffectiveness = type1Effectiveness * type2Effectiveness;

  // Klutz doesn't let Iron Ball ground in generation 4
  if (typeEffectiveness === 0 && move.hasType('Ground') &&
    (defender.hasItem('Iron Ball') && !defender.hasAbility('Klutz'))) {
    if (type1Effectiveness === 0) {
      type1Effectiveness = 1;
    } else if (defender.types[1] && type2Effectiveness === 0) {
      type2Effectiveness = 1;
    }
    typeEffectiveness = type1Effectiveness * type2Effectiveness;
  }

  if (typeEffectiveness === 0) {
    return result;
  }
  if (defender.hasAbility('Cloud Guard') && defender.hasType('Flying') &&
    gen.types.get(toID(move.type))!.effectiveness['Flying']! > 1) {
    typeEffectiveness /= 2;
    desc.defenderAbility = defender.ability;
  }
  const ignoresWonderGuard = move.hasType('???') || move.named('Fire Fang');
  if ((!ignoresWonderGuard && defender.hasAbility('Wonder Guard') && typeEffectiveness <= 1) ||
    (move.hasType('Fire') && defender.hasAbility('Flash Fire', 'Flame Absorb', 'Shadow Convection')) ||
    (move.hasType('Water') && defender.hasAbility('Dry Skin', 'Water Absorb', 'Shadow Hydraulics')) ||
    (move.hasType('Bug') && defender.hasAbility('Bugcatcher')) ||
    (move.hasType('Ground') && defender.hasAbility('Clay Construction')) ||
    (move.hasType('Electric') && defender.hasAbility('Motor Drive', 'Volt Absorb', 'Shadow Conduction')) ||
    (move.hasType('Ground') && !field.isGravity && !defender.hasItem('Iron Ball') &&
      // bone master does not go break through abilities other than inflate and levitate
      ((!(attacker.hasAbility('Bone Master') && move.flags.bone) &&
        (defender.hasAbility('Levitate') || (defender.hasAbility('Inflate') && defender.abilityOn))) ||
        (defender.named('Probopass') && defender.hasItem('Magnetic Stone')))) ||
    (move.flags.sound && defender.hasAbility('Soundproof')) ||
    (move.flags.blade && defender.hasAbility('Bladeproof')) ||
    (move.hasType('Ghost', 'Dark') && defender.hasAbility('Baku Shield')) ||
    (move.hasType('Poison') && defender.hasAbility('Acid Absorb')) ||
    (move.hasType('Dark') && defender.hasAbility('Karma')) ||
    (defender.named('Kiwuit') && defender.hasAbility('Ambrosia') && defender.item && gen.items.get(toID(defender.item))!.isBerry &&
      getNaturalGift(gen, defender.item)!.t === move.type)
  ) {
    desc.defenderAbility = defender.ability;
    return result;
  }

  desc.HPEVs = `${defender.evs.hp} HP`;

  const fixedDamage = handleFixedDamageMoves(attacker, move);
  if (fixedDamage) {
    result.damage = fixedDamage;
    return result;
  }

  if (move.named('Cat Burglary')) {
    let stat: StatID;
    for (stat in defender.boosts) {
      if (defender.boosts[stat] > 0) {
        attacker.boosts[stat] +=
          attacker.hasAbility('Contrary') ? -defender.boosts[stat]! : defender.boosts[stat]!;
        if (attacker.boosts[stat] > 6) attacker.boosts[stat] = 6;
        if (attacker.boosts[stat] < -6) attacker.boosts[stat] = -6;
        attacker.stats[stat] = getModifiedStat(attacker.rawStats[stat]!, attacker.boosts[stat]!);
        defender.boosts[stat] = 0;
        defender.stats[stat] = defender.rawStats[stat];
      }
    }
  }

  if (move.hits > 1) {
    desc.hits = move.hits;
  }
  const isPhysical = move.category === 'Physical';
  let basePower = calculateBasePowerDPP(gen, attacker, defender, move, field, hasAteAbilityTypeChange, desc);
  if (basePower === 0) {
    return result;
  }
  basePower = calculateBPModsDPP(attacker, defender, move, field, desc, basePower, hasAteAbilityTypeChange);

  // #endregion
  // #region (Special) Attack
  const attack = calculateAttackDPP(gen, attacker, defender, move, field, desc, isCritical);

  // #endregion
  // #region (Special) Defense
  const defense = calculateDefenseDPP(gen, attacker, defender, move, field, desc, isCritical);

  // #endregion
  // #region Damage

  let baseDamage = Math.floor(
    Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * basePower * attack) / 50) / defense
  );

  if (attacker.hasStatus('brn') && isPhysical && !attacker.hasAbility('Guts')) {
    baseDamage = Math.floor(baseDamage * 0.5);
    desc.isBurned = true;
  } else if (attacker.hasStatus('frz') && !isPhysical) {
    baseDamage = Math.floor(baseDamage * 0.5);
    desc.isFrozen = true;
  }

  baseDamage = calculateFinalModsDPP(baseDamage, attacker, defender, move, field, desc, isCritical);

  // the random factor is applied between the LO mod and the STAB mod, so don't apply anything
  // below this until we're inside the loop
  let stabMod = 1;
  if (move.hasType(...attacker.types)) {
    if (attacker.hasAbility('Adaptability')) {
      stabMod = 2;
      desc.attackerAbility = attacker.ability;
    } else {
      stabMod = 1.5;
    }
  }

  let filterMod = 1;
  if (defender.hasAbility('Filter', 'Solid Rock') && typeEffectiveness > 1) {
    filterMod = 0.75;
    desc.defenderAbility = defender.ability;
  }
  let royalGuardMod = 1;
  if (defender.hasAbility('Royal Guard') && defender.curHP() <= defender.maxHP() / 2) {
    royalGuardMod = 0.75;
    desc.defenderAbility = defender.ability;
  }
  let bagwormicadeMod = 1;
  if (defender.hasAbility('Bagwormicade') && typeEffectiveness > 1) {
    bagwormicadeMod = 0.5;
    desc.defenderAbility = defender.ability;
  }
  let enfeeblingVenomMod = 1;
  if (defender.hasAbility('Enfeebling Venom') && attacker.hasStatus('psn', 'tox')) {
    enfeeblingVenomMod = 0.5;
    desc.defenderAbility = defender.ability;
  }
  let ebeltMod = 1;
  if (attacker.hasItem('Expert Belt') && typeEffectiveness > 1) {
    ebeltMod = 1.2;
    desc.attackerItem = attacker.item;
  }
  let tintedMod = 1;
  if (attacker.hasAbility('Tinted Lens') && typeEffectiveness < 1) {
    tintedMod = 2;
    desc.attackerAbility = attacker.ability;
  }
  let berryMod = 1;
  if (move.hasType(getBerryResistType(defender.item)) &&
    (typeEffectiveness > 1 || move.hasType('Normal'))) {
    berryMod = 0.5;
    desc.defenderItem = defender.item;
  }
  let shadowShieldMod = 1;
  if (defender.hasAbility('Shadow Shield') &&
    (defender.curHP() === defender.maxHP() &&
      (!field.defenderSide.isSR && (!field.defenderSide.spikes || !isGrounded(defender, field))))) {
    shadowShieldMod = 0.5;
    desc.defenderAbility = defender.ability;
  }
  const damage: number[] = [];
  for (let i = 0; i < 16; i++) {
    damage[i] = Math.floor((baseDamage * (85 + i)) / 100);
    damage[i] = Math.floor(damage[i] * stabMod);
    damage[i] = Math.floor(damage[i] * type1Effectiveness);
    damage[i] = Math.floor(damage[i] * type2Effectiveness);
    damage[i] = Math.floor(damage[i] * filterMod);
    damage[i] = Math.floor(damage[i] * royalGuardMod)
    damage[i] = Math.floor(damage[i] * bagwormicadeMod);
    damage[i] = Math.floor(damage[i] * enfeeblingVenomMod);
    damage[i] = Math.floor(damage[i] * ebeltMod);
    damage[i] = Math.floor(damage[i] * tintedMod);
    damage[i] = Math.floor(damage[i] * berryMod);
    damage[i] = Math.floor(damage[i] * shadowShieldMod);
    damage[i] = Math.max(1, damage[i]);
  }
  result.damage = damage;

  if ((move.dropsStats && move.timesUsed! > 1) || move.hits > 1) {
    // store boosts so intermediate boosts don't show.
    const origDefBoost = desc.defenseBoost;
    const origAtkBoost = desc.attackBoost;
    let numAttacks = 1;
    if (move.dropsStats && move.timesUsed! > 1) {
      desc.moveTurns = `over ${move.timesUsed} turns`;
      numAttacks = move.timesUsed!;
    } else {
      numAttacks = move.hits;
    }
    let usedItems = [false, false];
    for (let times = 1; times < numAttacks; times++) {
      usedItems = checkMultihitBoost(gen, attacker, defender, move,
        field, desc, usedItems[0], usedItems[1]);
      let newBasePower = calculateBasePowerDPP(gen, attacker, defender, move, field, hasAteAbilityTypeChange, desc);
      newBasePower = calculateBPModsDPP(attacker, defender, move, field, desc, newBasePower, hasAteAbilityTypeChange);
      const newAtk = calculateAttackDPP(gen, attacker, defender, move, field, desc, isCritical);
      const newDef = calculateDefenseDPP(gen, attacker, defender, move, field, desc, isCritical);
      // Check if lost -ate ability. Typing stays the same, only boost is lost
      // Cannot be regained during multihit move and no Normal moves with stat drawbacks
      hasAteAbilityTypeChange = hasAteAbilityTypeChange && attacker.hasAbility('Normalize');
      let baseDamage = Math.floor(
        Math.floor(
          (Math.floor((2 * attacker.level) / 5 + 2) * newBasePower * newAtk) / 50
        ) / newDef
      );
      if (attacker.hasStatus('brn') && isPhysical && !attacker.hasAbility('Guts')) {
        baseDamage = Math.floor(baseDamage * 0.5);
        desc.isBurned = true;
      }
      baseDamage = calculateFinalModsDPP(baseDamage, attacker, defender, move, field, desc, isCritical);

      let damageMultiplier = 0;
      result.damage = result.damage.map(affectedAmount => {
        let newFinalDamage = 0;
        newFinalDamage = Math.floor((baseDamage * (85 + damageMultiplier)) / 100);
        newFinalDamage = Math.floor(newFinalDamage * stabMod);
        newFinalDamage = Math.floor(newFinalDamage * type1Effectiveness);
        newFinalDamage = Math.floor(newFinalDamage * type2Effectiveness);
        newFinalDamage = Math.floor(newFinalDamage * filterMod);
        newFinalDamage = Math.floor(newFinalDamage * royalGuardMod)
        newFinalDamage = Math.floor(newFinalDamage * bagwormicadeMod);
        newFinalDamage = Math.floor(newFinalDamage * enfeeblingVenomMod);
        newFinalDamage = Math.floor(newFinalDamage * ebeltMod);
        newFinalDamage = Math.floor(newFinalDamage * tintedMod);
        newFinalDamage = Math.max(1, newFinalDamage);
        damageMultiplier++;
        return affectedAmount + newFinalDamage;
      });
    }
    desc.defenseBoost = origDefBoost;
    desc.attackBoost = origAtkBoost;
  }

  return result;
}

export function calculateBasePowerDPP(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  hasAteAbilityTypeChange: boolean,
  desc: RawDesc,
  hit = 1,
) {
  let basePower = move.bp;
  const turnOrder = attacker.stats.spe > defender.stats.spe ? 'first' : 'last';

  // #endregion
  // #region Base Power

  switch (move.name) {
    case 'Brine':
      if (defender.curHP() <= defender.maxHP() / 2) {
        basePower *= 2;
        desc.moveBP = basePower;
      }
      break;
    case 'Eruption':
    case 'Icefall':
    case 'Water Spout':
      basePower = Math.max(1, Math.floor((basePower * attacker.curHP()) / attacker.maxHP()));
      desc.moveBP = basePower;
      break;
    case 'Facade':
      if (attacker.hasStatus('par', 'psn', 'tox', 'brn')) {
        basePower = move.bp * 2;
        desc.moveBP = basePower;
      }
      break;
    case 'Flail':
    case 'Reversal':
    case 'Shadow Vengeance':
      const p = Math.floor((64 * attacker.curHP()) / attacker.maxHP());
      basePower = p <= 1 ? 200 : p <= 5 ? 150 : p <= 12 ? 100 : p <= 21 ? 80 : p <= 42 ? 40 : 20;
      desc.moveBP = basePower;
      break;
    case 'Fling':
      basePower = getFlingPower(attacker.item);
      desc.moveBP = basePower;
      desc.attackerItem = attacker.item;
      break;
    case 'Grass Knot':
    case 'Shadow Trip':
    case 'Low Kick':
      const w = defender.weightkg;
      basePower = w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20;
      desc.moveBP = basePower;
      break;
    case 'Infernal Parade':
    case 'Shadow Sorcery':
      basePower = move.bp * (defender.status ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Snuggle Bug':
      basePower = 20 + 20 * countBoosts(gen, attacker.boosts);
      desc.moveBP = basePower;
      break;
    case 'Shadow Punish':
      basePower = 55 + 30 * countBoosts(gen, defender.boosts);
      desc.moveBP = basePower;
      break;
    case 'Gyro Ball':
    case 'Shadow Centrifuge':
      basePower = Math.min(150, Math.floor((25 * defender.stats.spe) / attacker.stats.spe));
      desc.moveBP = basePower;
      break;
    case 'Payback':
      if (turnOrder !== 'first') {
        basePower *= 2;
        desc.moveBP = basePower;
      }
      break;
    case 'Punishment':
      basePower = Math.min(200, 60 + 20 * countBoosts(gen, defender.boosts));
      desc.moveBP = basePower;
      break;
    case 'Wake-Up Slap':
      if (defender.hasStatus('slp')) {
        basePower *= 2;
        desc.moveBP = basePower;
      }
      break;
    case 'Nature Power':
      move.category = 'Special';
      move.secondaries = true;
      basePower = 80;
      desc.moveName = 'Tri Attack';
      break;
    case 'Crush Grip':
      basePower = Math.floor((defender.curHP() * 180) / defender.maxHP()) + 1;
      desc.moveBP = basePower;
      break;
    case 'Wring Out':
      basePower = Math.floor((defender.curHP() * 120) / defender.maxHP()) + 1;
      desc.moveBP = basePower;
      break;
    case 'Triple Kick':
      basePower = hit * 10;
      desc.moveBP = move.hits === 2 ? 30 : move.hits === 3 ? 60 : 10;
      break;
    case 'Weather Ball':
      basePower = move.bp * (field.weather ? 2 : 1);
      desc.moveBP = basePower;
      break;
    default:
      basePower = move.bp;
  }
  return basePower;
}
export function calculateBPModsDPP(
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  basePower: number,
  hasAteAbilityTypeChange: boolean,
) {

  if (field.attackerSide.isHelpingHand) {
    basePower = Math.floor(basePower * 1.5);
    desc.isHelpingHand = true;
  }
  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }
  const isPhysical = move.category === 'Physical';
  if ((attacker.hasItem('Muscle Band') && isPhysical) ||
    (attacker.hasItem('Wise Glasses') && !isPhysical)) {
    basePower = Math.floor(basePower * 1.1);
    desc.attackerItem = attacker.item;
  } else if (move.hasType(getItemBoostType(attacker.item)) ||
    (attacker.hasItem('Adamant Orb') &&
      attacker.named('Dialga') &&
      move.hasType('Steel', 'Dragon')) ||
    (attacker.hasItem('Lustrous Orb') &&
      attacker.named('Palkia') &&
      move.hasType('Water', 'Dragon')) ||
    (attacker.hasItem('Griseous Orb') &&
      attacker.named('Giratina-Origin') &&
      move.hasType('Ghost', 'Dragon'))
  ) {
    basePower = Math.floor(basePower * 1.2);
    desc.attackerItem = attacker.item;
  }
  if (attacker.hasAbility('Rivalry') && ((defender.hasType(attacker.types[0]) || (attacker.types[1] && defender.hasType(attacker.types[1]))))) {
    if (attacker.gender === defender.gender) {
      basePower = Math.floor(basePower * 1.2);
      // desc.rivalry can prob go unused
      // desc.rivalry = 'buffed';
    }
    desc.attackerAbility = attacker.ability;
  } else if (hasAteAbilityTypeChange) {
    basePower = Math.floor(basePower * 1.3);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Reckless') && (move.recoil || move.hasCrashDamage)) ||
    (attacker.hasAbility('Iron Fist') && move.flags.punch) ||
    (attacker.hasAbility('Cunning Blade') && move.flags.blade)) {
    basePower = Math.floor(basePower * 1.2);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.curHP() <= attacker.maxHP() / 3 &&
    ((attacker.hasAbility('Overgrow') && move.hasType('Grass')) ||
      (attacker.hasAbility('Blaze') && move.hasType('Fire')) ||
      (attacker.hasAbility('Torrent') && move.hasType('Water')) ||
      (attacker.hasAbility('Swarm') && move.hasType('Bug')))) ||
    (attacker.hasAbility('Technician') && basePower <= 60) ||
    (attacker.hasAbility('Escape Artist') && move.named('Flip Turn', 'U-turn', 'Volt Switch', 'Shadow Pivot', 'Propulsion Shot'))
  ) {
    basePower = Math.floor(basePower * 1.5);
    desc.attackerAbility = attacker.ability;
  }

  if ((defender.hasAbility('Heatproof') && move.hasType('Fire')) ||
    (defender.hasAbility('Thick Fat') && move.hasType('Fire', 'Ice')) ||
    (defender.hasAbility('Pure Heart', 'Shadow Armor') && move.hasType('Shadow'))) {
    basePower = Math.floor(basePower * 0.5);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Dry Skin') && move.hasType('Fire')) {
    basePower = Math.floor(basePower * 1.25);
    desc.defenderAbility = defender.ability;
  }
  if (attacker.hasAbility('High Caliber') && move.flags.bullet) {
    basePower = Math.floor(basePower * 1.3);
    desc.defenderAbility = defender.ability;
  } else if (attacker.hasAbility('Striker') && move.flags.kick) {
    basePower = Math.floor(basePower * 1.2);
    desc.attackerAbility = attacker.ability;
  }
  if ((attacker.hasItem('Electirizer') && attacker.named('Electivire') && move.hasType('Electric')) ||
    (attacker.hasItem('Magmarizer') && attacker.named('Magmortar') && move.hasType('Fire'))) {
    basePower = Math.floor(basePower * 1.5);
    desc.attackerItem = attacker.item;
  }
  return basePower;
}

export function calculateAttackDPP(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {
  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }
  const isPhysical = move.category === 'Physical';
  const attackStat = isPhysical ? 'atk' : 'spa';
  desc.attackEVs = getEVDescriptionText(gen, attacker, attackStat, attacker.nature);
  let attack: number;
  const attackBoost = attacker.boosts[attackStat];
  const rawAttack = attacker.rawStats[attackStat];
  if (attackBoost === 0 || (isCritical && attackBoost < 0)) {
    attack = rawAttack;
  } else if (defender.hasAbility('Unaware')) {
    attack = rawAttack;
    desc.defenderAbility = defender.ability;
  } else if (attacker.hasAbility('Simple')) {
    attack = getSimpleModifiedStat(rawAttack, attackBoost);
    desc.attackerAbility = attacker.ability;
    desc.attackBoost = attackBoost;
  } else {
    attack = getModifiedStat(rawAttack, attackBoost);
    desc.attackBoost = attackBoost;
  }

  if ((isPhysical && attacker.hasAbility('Pure Power', 'Huge Power')) ||
    (!isPhysical && attacker.hasAbility('Mystic Power'))) {
    attack *= 2;
    desc.attackerAbility = attacker.ability;
  } else if ((field.hasWeather('Sun') && ((attacker.hasAbility('Solar Power') && move.category === 'Special') ||
    (attacker.hasAbility('Solar Boost') && move.category === 'Physical') ||
    ((attacker.named('Cherrim') && attacker.hasAbility('Flower Gift')) && move.category === 'Physical'))) ||
    (field.hasWeather('Hail') && attacker.hasAbility('Ice Breaker') && move.category === 'Physical')) {
    attack = Math.floor(attack * 1.5);
    desc.attackerAbility = attacker.ability;
    desc.weather = field.weather;
  } else if (attacker.hasAbility('Galaxian') && field.isGravity && move.category === 'Special') {
    attack = Math.floor(attack * 1.5);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Craftsman') && move.hasType('Rock', 'Steel', 'Ice')) {
    attack = Math.floor(attack * 1.5);
    desc.attackerAbility = 'Craftsman';
  } else if (attacker.hasAbility('Ultimate Craftsman') && move.hasType('Rock', 'Steel', 'Ice')) {
    attack = Math.floor(attack * 2);
    desc.attackerAbility = 'Ultimate Craftsman';
  } else if ((attacker.hasAbility('Corona') && move.hasType('Fire')) ||
    (attacker.hasAbility('Royal Guard') && attacker.curHP() <= attacker.maxHP() / 2)) {
    attack = Math.floor(attack * 1.5);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Shadow Adaptation') && move.hasType('Shadow')) {
    attack = Math.floor(attack * 2);
    desc.attackerAbility = attacker.ability;
  } else if (field.attackerSide.isFlowerGift && field.hasWeather('Sun') && isPhysical) {
    attack = Math.floor(attack * 1.5);
    desc.weather = field.weather;
    desc.isFlowerGiftAttacker = true;
  } else if (
    (isPhysical &&
      (attacker.hasAbility('Hustle') || (attacker.hasAbility('Guts') && attacker.status)) ||
      ((attacker.curHP() <= attacker.maxHP() / 4) && (attacker.hasAbility('Adrenalize'))) ||
      (!isPhysical && attacker.abilityOn && attacker.hasAbility('Plus', 'Minus')))
  ) {
    attack = Math.floor(attack * 1.5);
    desc.attackerAbility = attacker.ability;
  } else if (isPhysical && attacker.hasAbility('Slow Start') && attacker.abilityOn) {
    attack = Math.floor(attack / 2);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Seismography') && move.hasType('Ground')) ||
    (attacker.hasAbility('Stench') && move.hasType('Poison'))) {
    attack = Math.floor(attack * 1.3);
    desc.attackerAbility = attacker.ability;
  }
  if (defender.hasAbility('Primal Warmth') && move.hasType('Fire', 'Water')) {
    attack = Math.floor(attack / 2);
    desc.defenderAbility = defender.ability;
  }

  if ((isPhysical ? attacker.hasItem('Choice Band') : attacker.hasItem('Choice Specs')) ||
    (!isPhysical && attacker.hasItem('Soul Dew') && attacker.named('Latios', 'Latias')) ||
    (isPhysical && attacker.hasItem('Bone Baton') && attacker.named('Osteoskhan'))) {
    attack = Math.floor(attack * 1.5);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Light Ball') && attacker.named('Pikachu')) ||
    (attacker.hasItem('Oval Stone') && attacker.named('Happiny')) ||
    (isPhysical && attacker.hasItem('Lucky Punch') && attacker.named('Chansey')) ||
    (attacker.hasItem('Amulet Coin') && attacker.name.includes('Meowth')) ||
    (attacker.hasItem('Thick Club') && attacker.named('Cubone', 'Marowak') && isPhysical) ||
    (attacker.hasItem('Deep Sea Tooth') && attacker.named('Clamperl') && !isPhysical)
  ) {
    attack *= 2;
    desc.attackerItem = attacker.item;
  }
  return attack;
}
export function calculateDefenseDPP(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {
  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }
  const isPhysical = move.category === 'Physical';
  if (move.named('Combardment') && (defender.stats.def > defender.stats.spd)) {
    move.overrideDefensiveStat = 'spd';
  }
  const defenseStat = move.overrideDefensiveStat || move.category === 'Physical' ? 'def' : 'spd';
  desc.defenseEVs = getEVDescriptionText(gen, defender, defenseStat, defender.nature);
  let defense: number;
  const defenseBoost = defender.boosts[defenseStat];
  const rawDefense = defender.rawStats[defenseStat];
  if (defenseBoost === 0 || (isCritical && defenseBoost > 0)) {
    defense = rawDefense;
  } else if (attacker.hasAbility('Unaware')) {
    defense = rawDefense;
    desc.attackerAbility = attacker.ability;
  } else if (defender.hasAbility('Simple')) {
    defense = getSimpleModifiedStat(rawDefense, defenseBoost);
    desc.defenderAbility = defender.ability;
    desc.defenseBoost = defenseBoost;
  } else {
    defense = getModifiedStat(rawDefense, defenseBoost);
    desc.defenseBoost = defenseBoost;
  }

  if (defender.hasAbility('Marvel Scale') && defender.status && isPhysical) {
    defense = Math.floor(defense * 1.5);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Stall')) {
    defense = Math.floor(defense * 1.3);
    desc.defenderAbility = defender.ability;
  }
  if (defender.hasAbility('Flower Gift') && field.hasWeather('Sun') && !isPhysical) {
    defense = Math.floor(defense * 1.5);
    desc.defenderAbility = defender.ability;
    desc.weather = field.weather;
  } else if (field.defenderSide.isFlowerGift && field.hasWeather('Sun') && !isPhysical) {
    defense = Math.floor(defense * 1.5);
    desc.weather = field.weather;
    desc.isFlowerGiftDefender = true;
  }

  if (defender.hasItem('Soul Dew') && defender.named('Latios', 'Latias') && !isPhysical) {
    defense = Math.floor(defense * 1.5);
    desc.defenderItem = defender.item;
  } else if (
    (defender.hasItem('Deep Sea Scale') && defender.named('Clamperl') && !isPhysical) ||
    (defender.hasItem('Metal Powder') && defender.named('Ditto') && isPhysical)
  ) {
    defense *= 2;
    desc.defenderItem = defender.item;
  }

  if (field.hasWeather('Sand') && defender.hasType('Rock') && !isPhysical) {
    defense = Math.floor(defense * 1.5);
    desc.weather = field.weather;
  }
  if (field.hasWeather('Hail') && defender.hasType('Ice') && isPhysical) {
    defense = Math.floor(defense * 1.5);
    desc.weather = field.weather;
  }

  if (move.named('Explosion') || move.named('Self-Destruct')) {
    defense = Math.floor(defense * 0.5);
  }

  if (defense < 1) {
    defense = 1;
  }
  return defense;
}

function calculateFinalModsDPP(
  baseDamage: number,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
) {
  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }
  const isPhysical = move.category === 'Physical';


  if (!isCritical) {
    const screenMultiplier = field.gameType !== 'Singles' ? 2 / 3 : 1 / 2;
    if (isPhysical && field.defenderSide.isReflect) {
      baseDamage = Math.floor(baseDamage * screenMultiplier);
      desc.isReflect = true;
    } else if (!isPhysical && field.defenderSide.isLightScreen) {
      baseDamage = Math.floor(baseDamage * screenMultiplier);
      desc.isLightScreen = true;
    }
  }

  if (field.gameType !== 'Singles' &&
    ['allAdjacent', 'allAdjacentFoes'].includes(move.target)) {
    baseDamage = Math.floor((baseDamage * 3) / 4);
  }

  if (defender.hasAbility('Shadow Shield')) {

  }

  if ((field.hasWeather('Sun') && move.hasType('Fire')) ||
    (field.hasWeather('Rain') && move.hasType('Water')) ||
    (field.hasWeather('Miasma') && move.hasType('Poison'))) {
    baseDamage = Math.floor(baseDamage * 1.5);
    desc.weather = field.weather;
  } else if (
    (field.hasWeather('Sun') && move.hasType('Water')) ||
    (field.hasWeather('Rain') && move.hasType('Fire')) ||
    (move.named('Solar Beam') && field.hasWeather('Rain', 'Sand', 'Hail', 'Miasma'))
  ) {
    baseDamage = Math.floor(baseDamage * 0.5);
    desc.weather = field.weather;
  }

  if (attacker.hasAbility('Flash Fire') && attacker.abilityOn && move.hasType('Fire')) {
    baseDamage = Math.floor(baseDamage * 1.5);
    desc.attackerAbility = 'Flash Fire';
  }
  baseDamage += 2;

  if (isCritical) {
    if (attacker.hasAbility('Sniper')) {
      baseDamage *= 3;
      desc.attackerAbility = attacker.ability;
    } else {
      baseDamage *= 2;
    }
    desc.isCritical = isCritical;
  }

  if (attacker.hasItem('Life Orb')) {
    baseDamage = Math.floor(baseDamage * 1.3);
    desc.attackerItem = attacker.item;
  }

  if (move.named('Pursuit') && field.defenderSide.isSwitching === 'out') {
    // technician negates switching boost, thanks DaWoblefet
    if (attacker.hasAbility('Technician')) {
      baseDamage = Math.floor(baseDamage * 1);
    } else {
      baseDamage = Math.floor(baseDamage * 2);
      desc.isSwitching = 'out';
    }
  }
  // #endregion

  return baseDamage;
}

function getSimpleModifiedStat(stat: number, mod: number) {
  const simpleMod = Math.min(6, Math.max(-6, mod * 2));
  return simpleMod > 0
    ? Math.floor((stat * (2 + simpleMod)) / 2)
    : simpleMod < 0 ? Math.floor((stat * 2) / (2 - simpleMod)) : stat;
}

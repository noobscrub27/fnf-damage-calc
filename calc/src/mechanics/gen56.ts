import {Generation, AbilityName, StatID} from '../data/interface';
import {toID} from '../util';
import {
  getItemBoostType,
  getNaturalGift,
  getFlingPower,
  getBerryResistType,
  getTechnoBlast,
  getOrbType,
} from '../items';
import {RawDesc} from '../desc';
import {Field} from '../field';
import {Move} from '../move';
import {Pokemon} from '../pokemon';
import {Result} from '../result';
import {
  chainMods,
  checkAirLock,
  checkDownload,
  checkSearchEngine,
  checkInflate,
  checkSillySoda,
  checkForecast,
  checkInfiltrator,
  checkScreenBreakers,
  checkIntimidate,
  checkItem,
  checkMultihitBoost,
  checkSeedBoost,
  checkWonderRoom,
  computeFinalStats,
  countBoosts,
  getBaseDamage,
  getEVDescriptionText,
  getFinalDamage,
  getModifiedStat,
  getMoveEffectiveness,
  getStabMod,
  getWeight,
  handleFixedDamageMoves,
  isGrounded,
  OF16, OF32,
  pokeRound,
} from './util';

export function calculateBWXY(
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
  checkItem(attacker, field.isMagicRoom);
  checkItem(defender, field.isMagicRoom);
  checkWonderRoom(attacker, field.isWonderRoom);
  checkWonderRoom(defender, field.isWonderRoom);
  checkSeedBoost(attacker, field);
  checkSeedBoost(defender, field);
  checkSearchEngine(defender, attacker);
  checkSearchEngine(attacker, defender);
  checkInflate(attacker);
  checkInflate(defender);

  computeFinalStats(gen, attacker, defender, field, 'def', 'spd', 'spe');

  checkIntimidate(gen, attacker, defender);
  checkIntimidate(gen, defender, attacker);
  checkDownload(attacker, defender, field.isWonderRoom);
  checkDownload(defender, attacker, field.isWonderRoom);
  checkSillySoda(attacker, gen);
  checkSillySoda(defender, gen);
  computeFinalStats(gen, attacker, defender, field, 'atk', 'spa');

  checkScreenBreakers(attacker, move, field.defenderSide);
  checkInfiltrator(attacker, field.defenderSide);
  checkInfiltrator(defender, field.attackerSide);

  const desc: RawDesc = {
    attackerName: attacker.name,
    moveName: move.name,
    defenderName: defender.name,
    isWonderRoom: field.isWonderRoom,
  };

  const result = new Result(gen, attacker, defender, move, field, 0, desc);

  if (move.category === 'Status' && !move.named('Nature Power')) {
    return result;
  }
  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
  }
  if (field.defenderSide.isProtected && !move.breaksProtect) {
    desc.isProtected = true;
    return result;
  }
  if (field.isMysteryRoom) {
    defender.ability = '' as AbilityName;
    attacker.ability = '' as AbilityName;
  }
  if (attacker.hasAbility('Mold Breaker', 'Teravolt', 'Turboblaze')) {
    defender.ability = '' as AbilityName;
    desc.attackerAbility = attacker.ability;
  }

  const isCritical =
    (move.isCrit || (attacker.named('Chansey') && attacker.hasItem('Lucky Punch') && move.flags.punch === 1 && gen.num >= 6))
    && !defender.hasAbility('Battle Armor', 'Shell Armor') && !(defender.hasAbility('Pure Heart', 'Shadow Armor') && move.hasType('Shadow'))
    && move.timesUsed === 1;

  if (move.named('Weather Ball')) {
    move.type =
      field.hasWeather('Sun', 'Harsh Sunshine') ? 'Fire'
        : field.hasWeather('Rain', 'Heavy Rain') ? 'Water'
          : field.hasWeather('Sand') ? 'Rock'
            : field.hasWeather('Hail') ? 'Ice'
              : field.hasWeather('Miasma') ? 'Poison'
                : 'Normal';
    desc.weather = field.weather;
    desc.moveType = move.type;
  } else if (move.named('Judgment') && attacker.item && attacker.item.includes('Plate')) {
    move.type = getItemBoostType(attacker.item)!;
  } else if (move.named('Primal Burst') && attacker.item && attacker.item.includes('Orb')) {
    move.type = getOrbType(attacker.item)!;
  } else if (move.named('Techno Blast') && attacker.item && attacker.item.includes('Drive')) {
    move.type = getTechnoBlast(attacker.item)!;
  } else if (move.named('Natural Gift') && attacker.item && attacker.item.endsWith('Berry')) {
    const gift = getNaturalGift(gen, attacker.item)!;
    move.type = gift.t;
    move.bp = gift.p;
    desc.attackerItem = attacker.item;
    desc.moveBP = move.bp;
    desc.moveType = move.type;
  } else if (move.named('Nature Power')) {
    if (gen.num === 5) {
      move.type = 'Ground';
    } else {
      move.type =
        field.hasTerrain('Electric') ? 'Electric'
          : field.hasTerrain('Grassy') ? 'Grass'
            : field.hasTerrain('Misty') ? 'Fairy'
              : 'Normal';
    }
  } else if (move.named('Seasonal Spirit')) {
    if (attacker.named('Sawsbuck-Spring')) {
      move.type = 'Fairy';
    } else if (attacker.named('Sawsbuck-Summer')) {
      move.type = 'Fire';
    } else if (attacker.named('Sawsbuck-Autumn')) {
      move.type = 'Ground';
    } else if (attacker.named('Sawsbuck-Winter')) {
      move.type = 'Ice';
    }
  }

  if (attacker.hasAbility('Cunning Blade') && move.category === 'Physical' && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }

  let hasAteAbilityTypeChange = false;
  let isAerilate = false;
  let isMalevolate = false;
  let isPixilate = false;
  let isRefrigerate = false;
  let isToxicate = false;
  let isDraconize = false;
  let isNormalize = false;
  const noTypeChange =
    move.named('Judgment', 'Nature Power', 'Techo Blast', 'Natural Gift', 'Weather Ball',
      'Struggle');

  if (!move.isZ && !noTypeChange) {
    const normal = move.hasType('Normal');
    if ((isAerilate = attacker.hasAbility('Aerilate') && normal)) {
      move.type = 'Flying';
    } else if ((isMalevolate = attacker.hasAbility('Malevolate') && normal)) {
      move.type = 'Dark';
    } else if ((isPixilate = attacker.hasAbility('Pixilate') && normal)) {
      move.type = 'Fairy';
    } else if ((isRefrigerate = attacker.hasAbility('Refrigerate') && normal)) {
      move.type = 'Ice';
    } else if ((isToxicate = attacker.hasAbility('Toxicate') && normal)) {
      move.type = 'Poison';
    } else if ((isDraconize = attacker.hasAbility('Draconize') && normal)) {
      move.type = 'Dragon';
    } else if ((isNormalize = attacker.hasAbility('Normalize'))) {
      move.type = 'Normal';
    }
    if (isMalevolate || isPixilate || isRefrigerate || isToxicate || isAerilate || isDraconize || isNormalize) {
      desc.attackerAbility = attacker.ability;
      hasAteAbilityTypeChange = true;
    }
  }

  if (attacker.hasAbility('Gale Wings') && move.hasType('Flying') ||
    (attacker.hasAbility('Melody Allegretto') && move.flags.sound)) {
    move.priority = 1;
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Stall')) {
    move.priority = -1;
    desc.attackerAbility = attacker.ability;
  }

  const isGhostRevealed = attacker.hasAbility('Scrappy') || field.defenderSide.isForesight;
  const isDarkRevealed = field.defenderSide.isMiracleEye || attacker.hasAbility('Psyche Control');
  const isBoneMaster = attacker.hasAbility('Bone Master') && !!move.flags.bone;
  const type1Effectiveness =
    getMoveEffectiveness(gen, move, defender.types[0], isGhostRevealed, isDarkRevealed, field.isGravity, false, isBoneMaster);
  const type2Effectiveness = defender.types[1]
    ? getMoveEffectiveness(gen, move, defender.types[1], isGhostRevealed, isDarkRevealed, field.isGravity, false, isBoneMaster)
    : 1;
  let typeEffectiveness = type1Effectiveness * type2Effectiveness;

  if (typeEffectiveness === 0 && move.named('Thousand Arrows')) {
    typeEffectiveness = 1;
  } else if (typeEffectiveness === 0 && move.hasType('Ground') &&
    defender.hasItem('Iron Ball') && !defender.hasAbility('Klutz')) {
    typeEffectiveness = 1;
  } else if (typeEffectiveness === 0 && defender.hasItem('Ring Target')) {
    const effectiveness = gen.types.get(toID(move.type))!.effectiveness;
    if (effectiveness[defender.types[0]]! === 0) {
      typeEffectiveness = type2Effectiveness;
    } else if (defender.types[1] && effectiveness[defender.types[1]]! === 0) {
      typeEffectiveness = type1Effectiveness;
    }
  }

  if (typeEffectiveness === 0) {
    return result;
  }

  if ((move.named('Sky Drop') &&
    (defender.hasType('Flying') || defender.weightkg >= 200 || field.isGravity)) ||
    (move.named('Dream Eater') && !defender.hasStatus('slp'))
  ) {
    return result;
  }

  if (
    (field.hasWeather('Harsh Sunshine') && move.hasType('Water')) ||
    (field.hasWeather('Heavy Rain') && move.hasType('Fire'))
  ) {
    desc.weather = field.weather;
    return result;
  }

  // Strong Winds and Cloud Guard both remove flying-type weaknesses. They don't stack.
  if ((field.hasWeather('Strong Winds') || defender.hasAbility('Cloud Guard')) && defender.hasType('Flying') &&
    gen.types.get(toID(move.type))!.effectiveness['Flying']! > 1) {
    typeEffectiveness /= 2;
    if (field.hasWeather('Strong Winds')) {
      desc.weather = field.weather;
    } else {
      desc.defenderAbility = defender.ability;
    }
  }
  if ((defender.hasAbility('Wonder Guard') && typeEffectiveness <= 1) ||
    (move.hasType('Grass') && defender.hasAbility('Sap Sipper')) ||
    (move.hasType('Fire') && defender.hasAbility('Flash Fire', 'Flame Absorb', 'Shadow Convection')) ||
    (move.hasType('Ice') && defender.hasAbility('Tropical Current')) ||
    (move.hasType('Water') && defender.hasAbility('Dry Skin', 'Storm Drain', 'Water Absorb', 'Shadow Hydraulics')) ||
    (move.hasType('Bug') && defender.hasAbility('Bugcatcher')) ||
    (move.hasType('Ground') && defender.hasAbility('Clay Construction')) ||
    (move.hasType('Electric') &&
      defender.hasAbility('Lightning Rod', 'Motor Drive', 'Volt Absorb', 'Shadow Conduction')) ||
    (move.hasType('Ground') && !field.isGravity && !move.named('Thousand Arrows') && !defender.hasItem('Iron Ball') &&
      // bone master does not go break through abilities other than inflate and levitate
      ((!(attacker.hasAbility('Bone Master') && move.flags.bone) &&
        (defender.hasAbility('Levitate') || (defender.hasAbility('Inflate') && defender.abilityOn))) ||
        (defender.named('Probopass') && defender.hasItem('Magnetic Stone')))) ||
    (move.flags.bullet && defender.hasAbility('Bulletproof')) ||
    (move.flags.sound && defender.hasAbility('Soundproof')) ||
    (move.flags.blade && defender.hasAbility('Bladeproof')) ||
    (move.hasType('Poison') && defender.hasAbility('Acid Absorb')) ||
    (move.hasType('Dark') && defender.hasAbility('Karma', 'Baku Shield')) ||
    (defender.named('Kiwuit') && defender.hasAbility('Ambrosia') && defender.item && gen.items.get(toID(defender.item))!.isBerry &&
      getNaturalGift(gen, defender.item)!.t === move.type)
  ) {
    desc.defenderAbility = defender.ability;
    return result;
  }

  if (move.hasType('Ground') && !move.named('Thousand Arrows') &&
    !field.isGravity && defender.hasItem('Air Balloon')) {
    desc.defenderItem = defender.item;
    return result;
  }

  if (move.priority > 0 && field.hasTerrain('Psychic') && isGrounded(defender, field)) {
    desc.terrain = field.terrain;
    return result;
  }

  desc.HPEVs = `${defender.evs.hp} HP`;

  const fixedDamage = handleFixedDamageMoves(attacker, move);
  if (fixedDamage) {
    if (attacker.hasAbility('Parental Bond')) {
      result.damage = [fixedDamage, fixedDamage];
      desc.attackerAbility = attacker.ability;
    } else {
      result.damage = fixedDamage;
    }
    return result;
  }

  if (move.named('Final Gambit')) {
    result.damage = attacker.curHP();
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

  // #endregion
  // #region Base Power

  const basePower = calculateBasePowerBWXY(
    gen,
    attacker,
    defender,
    move,
    field,
    hasAteAbilityTypeChange,
    desc
  );
  if (basePower === 0) {
    return result;
  }

  // #endregion
  // #region (Special) Attack

  const attack = calculateAttackBWXY(gen, attacker, defender, move, field, desc, isCritical);
  const attackStat = move.category === 'Special' ? 'spa' : 'atk';

  // #endregion
  // #region (Special) Defense

  const defense = calculateDefenseBWXY(gen, attacker, defender, move, field, desc, isCritical);

  // #endregion
  // #region Damage

  const baseDamage = calculateBaseDamageBWXY(
    gen,
    attacker,
    basePower,
    attack,
    defense,
    move,
    field,
    desc,
    isCritical
  );

  // the random factor is applied between the crit mod and the stab mod, so don't apply anything
  // below this until we're inside the loop
  let stabMod = getStabMod(attacker, move, desc);

  const applyBurn =
    attacker.hasStatus('brn') &&
    move.category === 'Physical' &&
    !attacker.hasAbility('Guts') &&
    !(move.named('Facade') && gen.num === 6);
  desc.isBurned = applyBurn;
  const applyFreeze = attacker.hasStatus('frz') && move.category === 'Special';
  desc.isFrozen = applyFreeze;
  const statusReducesDamage = applyBurn || applyFreeze;

  const finalMods = calculateFinalModsBWXY(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    isCritical,
    typeEffectiveness
  );
  const finalMod = chainMods(finalMods, 41, 131072);

  const isSpread = field.gameType !== 'Singles' &&
    ['allAdjacent', 'allAdjacentFoes'].includes(move.target);

  let childDamage: number[] | undefined;
  if (attacker.hasAbility('Parental Bond') && move.hits === 1 && !isSpread) {
    const child = attacker.clone();
    child.ability = 'Parental Bond (Child)' as AbilityName;
    checkMultihitBoost(gen, child, defender, move, field, desc);
    childDamage = calculateBWXY(gen, child, defender, move, field).damage as number[];
    desc.attackerAbility = attacker.ability;
  }

  let damage: number[] = [];
  for (let i = 0; i < 16; i++) {
    damage[i] =
      getFinalDamage(baseDamage, i, typeEffectiveness, statusReducesDamage, stabMod, finalMod);
  }

  desc.attackBoost =
    move.named('Foul Play') ? defender.boosts[attackStat] : attacker.boosts[attackStat];

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
      const newAtk = calculateAttackBWXY(gen, attacker, defender, move, field, desc, isCritical);
      const newDef = calculateDefenseBWXY(gen, attacker, defender, move, field, desc, isCritical);
      // Check if lost -ate ability. Typing stays the same, only boost is lost
      // Cannot be regained during multihit move and no Normal moves with stat drawbacks
      hasAteAbilityTypeChange = hasAteAbilityTypeChange &&
        attacker.hasAbility('Aerilate', 'Galvanize', 'Toxicate', 'Malevolate', 'Draconize', 'Pixilate', 'Refrigerate', 'Normalize');

      if ((move.dropsStats && move.timesUsed! > 1)) {
        // Adaptability does not change between hits of a multihit, only between turns
        stabMod = getStabMod(attacker, move, desc);
      }

      const newBasePower = calculateBasePowerBWXY(
        gen,
        attacker,
        defender,
        move,
        field,
        hasAteAbilityTypeChange,
        desc
      );
      const newBaseDamage = getBaseDamage(attacker.level, newBasePower, newAtk, newDef);
      const newFinalMods = calculateFinalModsBWXY(
        gen,
        attacker,
        defender,
        move,
        field,
        desc,
        isCritical,
        typeEffectiveness,
        times
      );
      const newFinalMod = chainMods(newFinalMods, 41, 131072);

      let damageMultiplier = 0;
      damage = damage.map(affectedAmount => {
        const newFinalDamage = getFinalDamage(
          newBaseDamage,
          damageMultiplier,
          typeEffectiveness,
          applyBurn,
          stabMod,
          newFinalMod
        );
        damageMultiplier++;
        return affectedAmount + newFinalDamage;
      });
    }
    desc.defenseBoost = origDefBoost;
    desc.attackBoost = origAtkBoost;
  }

  result.damage = childDamage ? [damage, childDamage] : damage;

  // #endregion

  return result;
}

export function calculateBasePowerBWXY(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  hasAteAbilityTypeChange: boolean,
  desc: RawDesc,
  hit = 1,
) {
  let basePower: number;
  const turnOrder = attacker.stats.spe > defender.stats.spe ? 'first' : 'last';

  switch (move.name) {
    case 'Payback':
      basePower = move.bp * (turnOrder === 'last' ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Synchronoise':
      basePower = move.bp * ((defender.hasType(attacker.types[0]) || (attacker.types[1] && defender.hasType(attacker.types[1]))) ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Pursuit':
      const switching = field.defenderSide.isSwitching === 'out';
      basePower = move.bp * (switching ? 2 : 1);
      if (switching) desc.isSwitching = 'out';
      desc.moveBP = basePower;
      break;
    case 'Electro Ball':
    case 'Shadow Dart':
      if (defender.stats.spe === 0) defender.stats.spe = 1;
      const r = Math.floor(attacker.stats.spe / defender.stats.spe);
      basePower = r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40;
      desc.moveBP = basePower;
      break;
    case 'Gyro Ball':
    case 'Shadow Centrifuge':
      if (attacker.stats.spe === 0) attacker.stats.spe = 1;
      basePower = Math.min(150, Math.floor((25 * defender.stats.spe) / attacker.stats.spe) + 1);
      desc.moveBP = basePower;
      break;
    case 'Punishment':
      basePower = Math.min(200, 60 + 20 * countBoosts(gen, defender.boosts));
      desc.moveBP = basePower;
      break;
    case 'Low Kick':
    case 'Grass Knot':
    case 'Shadow Trip':
      const w = getWeight(defender, desc, 'defender');
      basePower = w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20;
      desc.moveBP = basePower;
      break;
    case 'Hex':
    case 'Infernal Parade':
    case 'Shadow Sorcery':
      basePower = move.bp * (defender.status ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Heavy Slam':
    case 'Shadow Anvil':
    case 'Heat Crash':
      const wr =
        getWeight(attacker, desc, 'attacker') /
        getWeight(defender, desc, 'defender');
      basePower = wr >= 5 ? 120 : wr >= 4 ? 100 : wr >= 3 ? 80 : wr >= 2 ? 60 : 40;
      desc.moveBP = basePower;
      break;
    case 'Stored Power':
    case 'Power Trip':
    case 'Snuggle Bug':
      basePower = 20 + 20 * countBoosts(gen, attacker.boosts);
      desc.moveBP = basePower;
      break;
    case 'Shadow Punish':
      basePower = 55 + 30 * countBoosts(gen, defender.boosts);
      desc.moveBP = basePower;
      break;
    case 'Acrobatics':
      basePower = move.bp * (attacker.hasItem('Flying Gem') || !attacker.item ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Assurance':
      basePower = move.bp * (defender.hasAbility('Parental Bond (Child)') ? 2 : 1);
      // NOTE: desc.attackerAbility = 'Parental Bond' will already reflect this boost
      break;
    case 'Wake-Up Slap':
      basePower = move.bp * (defender.hasStatus('slp') ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Smelling Salts':
      basePower = move.bp * (defender.hasStatus('par') ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Weather Ball':
      basePower = move.bp * (field.weather && !field.hasWeather('Strong Winds') ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Fling':
      basePower = getFlingPower(attacker.item);
      desc.moveBP = basePower;
      desc.attackerItem = attacker.item;
      break;
    case 'Eruption':
    case 'Icefall':
    case 'Water Spout':
      basePower = Math.max(1, Math.floor((150 * attacker.curHP()) / attacker.maxHP()));
      desc.moveBP = basePower;
      break;
    case 'Flail':
    case 'Reversal':
    case 'Shadow Vengeance':
      const p = Math.floor((48 * attacker.curHP()) / attacker.maxHP());
      basePower = p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20;
      desc.moveBP = basePower;
      break;
    case 'Nature Power':
      if (gen.num === 5) {
        move.category = 'Physical';
        move.target = 'allAdjacent';
        basePower = 100;
        desc.moveName = 'Earthquake';
      } else {
        move.category = 'Special';
        move.secondaries = true;
        switch (field.terrain) {
          case 'Electric':
            basePower = 90;
            desc.moveName = 'Thunderbolt';
            break;
          case 'Grassy':
            basePower = 90;
            desc.moveName = 'Energy Ball';
            break;
          case 'Misty':
            basePower = 95;
            desc.moveName = 'Moonblast';
            break;
          default:
            basePower = 80;
            desc.moveName = 'Tri Attack';
        }
      }
      break;
    // Triple Kick's damage doubles after each consecutive hit (20, 40, 60)
    case 'Triple Kick':
      basePower = hit * 20;
      desc.moveBP = move.hits === 2 ? 60 : move.hits === 3 ? 120 : 10;
      break;
    case 'Crush Grip':
      basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
      basePower = Math.floor(Math.floor((180 * basePower + 2048 - 1) / 4096) / 100) || 1;
      desc.moveBP = basePower;
      break;
    case 'Wring Out':
      basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
      basePower = Math.floor(Math.floor((120 * basePower + 2048 - 1) / 4096) / 100) || 1;
      desc.moveBP = basePower;
      break;
    default:
      basePower = move.bp;
  }

  if (basePower === 0) {
    return 0;
  }

  const bpMods = calculateBPModsBWXY(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    basePower,
    hasAteAbilityTypeChange,
    turnOrder
  );

  basePower = OF16(Math.max(1, pokeRound((basePower * chainMods(bpMods, 41, 2097152)) / 4096)));
  return basePower;
}


export function calculateBPModsBWXY(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  basePower: number,
  hasAteAbilityTypeChange: boolean,
  turnOrder: string
) {

  const bpMods = [];
  let resistedKnockOffDamage =
    !defender.item ||
    (defender.named('Giratina-Origin') && defender.hasItem('Griseous Orb')) ||
    (defender.name.includes('Arceus') && defender.item.includes('Plate')) ||
    (defender.name.includes('Genesect') && defender.item.includes('Drive')) ||
    (defender.named('Groudon', 'Groudon-Primal') && defender.hasItem('Red Orb')) ||
    (defender.named('Kyogre', 'Kyogre-Primal') && defender.hasItem('Blue Orb')) ||
    (defender.named('Kiwuit') && defender.hasAbility('Ambrosia') && defender.item && gen.items.get(toID(defender.item))!.isBerry) ||
    (defender.named('Meganium') && defender.hasItem('Fragrant Herb')) ||
    (defender.named('Tropius') && defender.hasItem('Banana Bunch')) ||
    (defender.named('Shedinja') && defender.hasItem('Cursed Crown')) ||
    (defender.named('Happiny') && defender.hasItem('Oval Stone')) ||
    (defender.named('Probopass') && defender.hasItem('Magnetic Stone')) ||
    (defender.named('Osteoskhan') && defender.hasItem('Bone Baton')) ||
    (defender.named('Spinda') && defender.hasItem('Silly Soda')) ||
    (defender.named('Darmanitan', 'Darmanizen', 'Darmanitan-Zen') && defender.hasItem('Calm Candy Bar')) ||
    (defender.named('Chansey') && defender.hasItem('Lucky Punch')) ||
    (defender.named('Gallade') && defender.hasItem('Knight\'s Edge')) ||
    (defender.named('Absol') && defender.hasItem('Night\'s Edge')) ||
    (defender.name.includes('Vespiquen') && defender.hasItem('Royal Jelly')) ||
    (defender.name.includes('Meowth') && defender.hasItem('Amulet Coin')) ||
    (defender.named('Magmortar') && defender.hasItem('Magmarizer')) ||
    (defender.named('Electivire') && defender.hasItem('Electirizer')) ||
    (defender.name.includes('Cherrim') && defender.hasItem('Cerise Orb')) ||
    (defender.name.includes('Phione') && defender.hasItem('Teal Orb'));

  // The last case only applies when the Pokemon is holding the Mega Stone that matches its species
  // (or when it's already a Mega-Evolution)
  // Alarix breaks naming conventions so it's hardcoded
  if (!resistedKnockOffDamage && defender.item) {
    const item = gen.items.get(toID(defender.item))!;
    resistedKnockOffDamage = !!(item.megaEvolves && defender.name.includes(item.megaEvolves)) ||
      (defender.named('Gyarados-Alarix', 'Gyarados-Mega-Alarix') && defender.hasItem('Alarixite'));
  }
  // Use BasePower after moves with custom BP to determine if Technician should boost
  if ((attacker.hasAbility('Technician') && basePower <= 60) ||
    (attacker.hasAbility('Flare Boost') &&
      attacker.hasStatus('brn') && move.category === 'Special')
  ) {
    bpMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Analytic') && turnOrder !== 'first') ||
    (attacker.hasAbility('Toxic Boost') && attacker.hasStatus('psn', 'tox') && move.category === 'Physical')) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Sand Force') && field.hasWeather('Sand') && move.hasType('Rock', 'Ground', 'Steel')) ||
    (attacker.hasAbility('Squall') && move.hasType('Flying', 'Water', 'Electric') && field.hasWeather('Rain', 'Heavy Rain'))
  ) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
    desc.weather = field.weather;
  } else if (
    (attacker.hasAbility('Reckless') && (move.recoil || move.hasCrashDamage)) ||
    (attacker.hasAbility('Iron Fist') && move.flags.punch) ||
    (attacker.hasAbility('Cunning Blade') && move.flags.blade)
  ) {
    bpMods.push(4915);
    desc.attackerAbility = attacker.ability;
  }

  if ((defender.hasAbility('Heatproof') && move.hasType('Fire')) ||
    (defender.hasAbility('Pure Heart', 'Shadow Armor') && move.hasType('Shadow'))) {
    bpMods.push(2048);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Dry Skin') && move.hasType('Fire')) {
    bpMods.push(5120);
    desc.defenderAbility = defender.ability;
  }
  if (attacker.hasAbility('High Caliber') && move.flags.bullet) {
    bpMods.push(5325);
    desc.defenderAbility = defender.ability;
  }
  if (attacker.hasAbility('Sheer Force') && move.secondaries) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  }

  if (attacker.hasAbility('Rivalry') && ((defender.hasType(attacker.types[0]) || (attacker.types[1] && defender.hasType(attacker.types[1]))))) {
    if (attacker.gender === defender.gender) {
      bpMods.push(4915);
      // desc.rivalry can prob go unused
      // desc.rivalry = 'buffed';
    }
    desc.attackerAbility = attacker.ability;
  }

  if ((attacker.item && getItemBoostType(attacker.item) === move.type) ||
    (attacker.named('Darmanitan', 'Darmanizen', 'Darmanitan-Zen') && attacker.hasItem('Calm Candy Bar') && move.category === 'Special')) {
    bpMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Muscle Band') && move.category === 'Physical') ||
    (attacker.hasItem('Wise Glasses') && move.category === 'Special')
  ) {
    bpMods.push(4505);
    desc.attackerItem = attacker.item;
  } else if (
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
    bpMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem(`${move.type} Gem`)) {
    bpMods.push(gen.num > 5 ? 5325 : 6144);
    desc.attackerItem = attacker.item;
  } else if ((attacker.hasItem('Electirizer') && attacker.named('Electivire') && move.hasType('Electric')) ||
    (attacker.hasItem('Magmarizer') && attacker.named('Magmortar') && move.hasType('Fire'))) {
    bpMods.push(6144);
    desc.attackerItem = attacker.item;
  }

  if ((move.named('Facade') && attacker.hasStatus('brn', 'par', 'psn', 'tox', 'frz')) ||
    (move.named('Brine') && defender.curHP() <= defender.maxHP() / 2) ||
    (move.named('Venoshock') && defender.hasStatus('psn', 'tox'))) {
    bpMods.push(8192);
    desc.moveBP = basePower * 2;
  } else if (gen.num > 5 && move.named('Knock Off') && !resistedKnockOffDamage) {
    bpMods.push(6144);
    desc.moveBP = basePower * 1.5;
  } else if (move.named('Solar Beam') && field.hasWeather('Rain', 'Heavy Rain', 'Sand', 'Hail', 'Miasma')) {
    bpMods.push(2048);
    desc.moveBP = basePower / 2;
    desc.weather = field.weather;
  }

  if (field.attackerSide.isHelpingHand) {
    bpMods.push(6144);
    desc.isHelpingHand = true;
  }

  if (hasAteAbilityTypeChange) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  } else if (
    (attacker.hasAbility('Mega Launcher') && move.flags.pulse) ||
    (attacker.hasAbility('Strong Jaw') && move.flags.bite) ||
    (attacker.hasAbility('Escape Artist') && move.named('Flip Turn', 'U-turn', 'Volt Switch', 'Shadow Pivot', 'Propulsion Shot'))
  ) {
    bpMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Tough Claws') && move.flags.contact) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Unsheathed') && move.flags.blade) ||
    (attacker.hasAbility('Striker') && move.flags.kick)) {
    bpMods.push(4915);
    desc.attackerAbility = attacker.ability;
  }

  const aura = `${move.type} Aura`;
  const isAttackerAura = attacker.hasAbility(aura);
  const isDefenderAura = defender.hasAbility(aura);
  const isUserAuraBreak = attacker.hasAbility('Aura Break') || defender.hasAbility('Aura Break');
  const isFieldAuraBreak = field.isAuraBreak;
  const isFieldFairyAura = field.isFairyAura && move.type === 'Fairy';
  const isFieldDarkAura = field.isDarkAura && move.type === 'Dark';
  const auraActive = isAttackerAura || isDefenderAura || isFieldFairyAura || isFieldDarkAura;
  const auraBreak = isFieldAuraBreak || isUserAuraBreak;
  if (auraActive) {
    if (auraBreak) {
      bpMods.push(3072);
      desc.attackerAbility = attacker.ability;
      desc.defenderAbility = defender.ability;
    } else {
      bpMods.push(5448);
      if (isAttackerAura) desc.attackerAbility = attacker.ability;
      if (isDefenderAura) desc.defenderAbility = defender.ability;
    }
  }

  // It's not actually clear if the terrain modifiers are base damage mods like weather or are
  // base power mods like in Gen 7+, but the research doesn't exist for this yet so we match PS here
  if (isGrounded(attacker, field)) {
    if ((field.hasTerrain('Electric') && move.hasType('Electric')) ||
      (field.hasTerrain('Grassy') && move.hasType('Grass'))
    ) {
      bpMods.push(6144);
      desc.terrain = field.terrain;
    }
  }
  if (isGrounded(defender, field)) {
    if ((field.hasTerrain('Misty') && move.hasType('Dragon')) ||
      (field.hasTerrain('Grassy') && move.named('Bulldoze', 'Earthquake'))
    ) {
      bpMods.push(2048);
      desc.terrain = field.terrain;
    }
  }
  return bpMods;
}

export function calculateAttackBWXY(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {

  let attack: number;
  const attackSource = move.named('Foul Play') ? defender : attacker;
  const attackStat = move.category === 'Special' ? 'spa' : 'atk';
  desc.attackEVs =
    move.named('Foul Play')
      ? getEVDescriptionText(gen, defender, attackStat, defender.nature)
      : getEVDescriptionText(gen, attacker, attackStat, attacker.nature);

  if (attackSource.boosts[attackStat] === 0 ||
    (isCritical && attackSource.boosts[attackStat] < 0)) {
    attack = attackSource.rawStats[attackStat];
  } else if ((defender.hasAbility('Unaware')) || (defender.named('Meganium') && defender.hasItem('Fragrant Herb'))) {
    attack = attackSource.rawStats[attackStat];
    desc.defenderAbility = defender.ability;
  } else {
    attack = getModifiedStat(attackSource.rawStats[attackStat]!, attackSource.boosts[attackStat]!);
    desc.attackBoost = attackSource.boosts[attackStat];
  }

  // unlike all other attack modifiers, Hustle gets applied directly
  if (attacker.hasAbility('Hustle') && move.category === 'Physical') {
    attack = pokeRound((attack * 3) / 2);
    desc.attackerAbility = attacker.ability;
  }
  const atMods = calculateAtModsBWXY(gen, attacker, defender, move, field, desc);
  attack = OF16(Math.max(1, pokeRound((attack * chainMods(atMods, 410, 131072)) / 4096)));
  return attack;
}

export function calculateAtModsBWXY(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc
) {

  const atMods = [];
  if ((defender.hasAbility('Thick Fat') && move.hasType('Fire', 'Ice')) ||
    (defender.hasAbility('Primal Warmth') && move.hasType('Fire', 'Water')) ||
    (defender.hasAbility('Mythocide') && move.hasType('Fairy'))) {
    atMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if ((attacker.hasAbility('Guts') && attacker.status && move.category === 'Physical') ||
    ((attacker.curHP() <= attacker.maxHP() / 4) && (attacker.hasAbility('Adrenalize'))) ||
    (attacker.curHP() <= attacker.maxHP() / 3 &&
      ((attacker.hasAbility('Overgrow') && move.hasType('Grass')) ||
        (attacker.hasAbility('Blaze') && move.hasType('Fire')) ||
        (attacker.hasAbility('Torrent') && move.hasType('Water')) ||
        (attacker.hasAbility('Swarm') && move.hasType('Bug')))) ||
    (move.category === 'Special' && attacker.abilityOn && attacker.hasAbility('Plus', 'Minus'))
  ) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Flash Fire') && attacker.abilityOn && move.hasType('Fire')) {
    atMods.push(6144);
    desc.attackerAbility = 'Flash Fire';
  } else if (attacker.hasAbility('Craftsman') && move.hasType('Rock', 'Steel', 'Ice')) {
    atMods.push(6144);
    desc.attackerAbility = 'Craftsman';
  } else if (attacker.hasAbility('Ultimate Craftsman') && move.hasType('Rock', 'Steel', 'Ice')) {
    atMods.push(8192);
    desc.attackerAbility = 'Ultimate Craftsman';
  } else if (attacker.hasAbility('Luminesce') && attacker.abilityOn && move.category === 'Special') {
    atMods.push(6144);
    desc.attackerAbility = 'Luminesce';
  } else if (attacker.hasAbility('Syzygy') && ((move.category == 'Special' && move.hasType('Fire')) ||
    (move.category == 'Physical' && move.hasType('Ice')))) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Corona') && move.hasType('Fire')) ||
    (attacker.hasAbility('Royal Guard') && attacker.curHP() <= attacker.maxHP() / 2)) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Shadow Birch') && move.category === 'Physical' && field.hasTerrain('Grassy')) ||
    (attacker.hasAbility('Shadow Ribbons') && move.category === 'Special' && field.hasTerrain('Misty')) ||
    (attacker.hasAbility('Shadow Sparks') && move.category === 'Special' && field.hasTerrain('Electric'))) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if ((field.hasWeather('Sun', 'Harsh Sunshine') && ((attacker.hasAbility('Solar Power') && move.category === 'Special') ||
    (attacker.hasAbility('Solar Boost') && move.category === 'Physical') ||
    ((attacker.named('Cherrim') && attacker.hasAbility('Flower Gift')) && move.category === 'Physical'))) ||
    (field.hasWeather('Hail') && attacker.hasAbility('Ice Breaker') && move.category === 'Physical')) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.weather = field.weather;
  } else if (attacker.hasAbility('Shadow Adaptation') && move.hasType('Shadow')) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Galaxian') && field.isGravity && move.category === 'Special') {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (
    field.attackerSide.isFlowerGift &&
    field.hasWeather('Sun', 'Harsh Sunshine') &&
    move.category === 'Physical') {
    atMods.push(6144);
    desc.weather = field.weather;
    desc.isFlowerGiftAttacker = true;
  } else if (
    (attacker.hasAbility('Defeatist') && attacker.curHP() <= attacker.maxHP() / 2) ||
    (attacker.hasAbility('Slow Start') && attacker.abilityOn && move.category === 'Physical')
  ) {
    atMods.push(2048);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Huge Power', 'Pure Power') && move.category === 'Physical') ||
    (attacker.hasAbility('Mystic Power') && move.category === 'Special')) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Seismography') && move.hasType('Ground')) ||
    (attacker.hasAbility('Stench') && move.hasType('Poison'))) {
    atMods.push(5325);
    desc.attackerAbility = attacker.ability;
  }

  if ((attacker.hasItem('Thick Club') &&
    attacker.named('Cubone', 'Marowak', 'Marowak-Alola') &&
    move.category === 'Physical') ||
    (attacker.hasItem('Deep Sea Tooth') &&
      attacker.named('Clamperl') &&
      move.category === 'Special') ||
    (attacker.hasItem('Light Ball') && attacker.name.startsWith('Pikachu')) ||
    (attacker.hasItem('Oval Stone') && attacker.name.startsWith('Happiny')) ||
    (move.category == 'Physical' && attacker.hasItem('Lucky Punch') && attacker.named('Chansey')) ||
    (attacker.hasItem('Amulet Coin') && attacker.name.includes('Meowth'))
  ) {
    atMods.push(8192);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Soul Dew') &&
      attacker.named('Latios', 'Latias', 'Latios-Mega', 'Latias-Mega') &&
      move.category === 'Special') ||
    (attacker.hasItem('Choice Band') && move.category === 'Physical') ||
    (attacker.hasItem('Choice Specs') && move.category === 'Special') ||
    (move.category === 'Physical' && attacker.hasItem('Bone Baton') && attacker.named('Osteoskhan')) ||
    (attacker.hasItem('Eviomight') && (gen.species.get(toID(attacker.name))?.nfe))
  ) {
    atMods.push(6144);
    desc.attackerItem = attacker.item;
  }
  return atMods;
}
export function calculateDefenseBWXY(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {

  if (move.named('Combardment') && (defender.stats.def > defender.stats.spd)) {
    move.overrideDefensiveStat = 'spd';
  }
  let defense: number;
  const defenseStat = move.overrideDefensiveStat || move.category === 'Physical' ? 'def' : 'spd';
  const hitsPhysical = defenseStat === 'def';
  desc.defenseEVs = getEVDescriptionText(gen, defender, defenseStat, defender.nature);
  if (defender.boosts[defenseStat] === 0 ||
    ((isCritical || (attacker.hasAbility('Big Pecks') && hitsPhysical)) && defender.boosts[defenseStat] > 0) ||
    move.ignoreDefensive) {
    defense = defender.rawStats[defenseStat];
  } else if ((attacker.hasAbility('Unaware')) || (attacker.named('Meganium') && attacker.hasItem('Fragrant Herb'))) {
    defense = defender.rawStats[defenseStat];
    desc.attackerAbility = attacker.ability;
  } else {
    defense = getModifiedStat(defender.rawStats[defenseStat]!, defender.boosts[defenseStat]!);
    desc.defenseBoost = defender.boosts[defenseStat];
  }

  // unlike all other defense modifiers, Sandstorm SpD boost gets applied directly
  if (field.hasWeather('Sand') && defender.hasType('Rock') && !hitsPhysical) {
    defense = pokeRound((defense * 3) / 2);
    desc.weather = field.weather;
  }
  if (field.hasWeather('Hail') && defender.hasType('Ice') && hitsPhysical) {
    defense = pokeRound((defense * 3) / 2);
    desc.weather = field.weather;
  }
  const dfMods = calculateDfModsBWXY(
    gen,
    defender,
    field,
    desc,
    hitsPhysical
  );
  defense = OF16(Math.max(1, pokeRound((defense * chainMods(dfMods, 410, 131072)) / 4096)));
  return defense;
}

export function calculateDfModsBWXY(
  gen: Generation,
  defender: Pokemon,
  field: Field,
  desc: RawDesc,
  hitsPhysical = false
) {

  const dfMods = [];
  if (defender.hasAbility('Marvel Scale') && defender.status && hitsPhysical) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
  } else if (
    defender.named('Cherrim') &&
    defender.hasAbility('Flower Gift') &&
    field.hasWeather('Sun', 'Harsh Sunshine') &&
    !hitsPhysical
  ) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
    desc.weather = field.weather;
  } else if (
    field.defenderSide.isFlowerGift &&
    field.hasWeather('Sun', 'Harsh Sunshine') &&
    !hitsPhysical) {
    dfMods.push(6144);
    desc.weather = field.weather;
    desc.isFlowerGiftDefender = true;
  }

  if (field.hasTerrain('Grassy') && defender.hasAbility('Grass Pelt') && hitsPhysical) {
    dfMods.push(8192);
    desc.defenderAbility = defender.ability;
  }

  if ((!hitsPhysical && defender.hasItem('Soul Dew') &&
    defender.named('Latios', 'Latias', 'Latios-Mega', 'Latias-Mega')) ||
    (defender.hasItem('Eviolite') && gen.species.get(toID(defender.name))?.nfe) ||
    (!hitsPhysical && defender.hasItem('Assault Vest'))) {
    dfMods.push(6144);
    desc.defenderItem = defender.item;
  }

  if ((defender.hasItem('Metal Powder') && defender.named('Ditto') && hitsPhysical) ||
    (defender.hasItem('Deep Sea Scale') && defender.named('Clamperl') && !hitsPhysical)) {
    dfMods.push(8192);
    desc.defenderItem = defender.item;
  }

  if (defender.hasAbility('Fur Coat') && hitsPhysical) {
    dfMods.push(8192);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Stall')) {
    dfMods.push(5325);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Luminesce') && defender.abilityOn && !hitsPhysical) {
    dfMods.push(6144);
    desc.defenderAbility = 'Luminesce';
  }
  return dfMods;
}

function calculateBaseDamageBWXY(
  gen: Generation,
  attacker: Pokemon,
  basePower: number,
  attack: number,
  defense: number,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
) {
  let baseDamage = getBaseDamage(attacker.level, basePower, attack, defense);

  const isSpread = field.gameType !== 'Singles' &&
    ['allAdjacent', 'allAdjacentFoes'].includes(move.target);
  if (isSpread) {
    baseDamage = pokeRound(OF32(baseDamage * 3072) / 4096);
  }

  if (attacker.hasAbility('Parental Bond (Child)')) {
    baseDamage = pokeRound(OF32(baseDamage * 2048) / 4096);
  }

  if ((field.hasWeather('Sun', 'Harsh Sunshine') && move.hasType('Fire')) ||
    (field.hasWeather('Rain', 'Heavy Rain') && move.hasType('Water')) ||
    (field.hasWeather('Miasma') && move.hasType('Poison'))) {
    baseDamage = pokeRound(OF32(baseDamage * 6144) / 4096);
    desc.weather = field.weather;
  } else if (
    (field.hasWeather('Sun') && move.hasType('Water')) ||
    (field.hasWeather('Rain') && move.hasType('Fire'))
  ) {
    baseDamage = pokeRound(OF32(baseDamage * 2048) / 4096);
    desc.weather = field.weather;
  }

  if (isCritical) {
    baseDamage = Math.floor(OF32(baseDamage * (gen.num > 5 ? 1.5 : 2)));
    desc.isCritical = isCritical;
  }

  return baseDamage;
}

function calculateFinalModsBWXY(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
  typeEffectiveness: number,
  hitCount = 0
) {
  const finalMods = [];

  if (field.defenderSide.isReflect && move.category === 'Physical' && !isCritical) {
    finalMods.push(field.gameType !== 'Singles' ? (gen.num > 5 ? 2732 : 2703) : 2048);
    desc.isReflect = true;
  } else if (field.defenderSide.isLightScreen && move.category === 'Special' && !isCritical) {
    finalMods.push(field.gameType !== 'Singles' ? (gen.num > 5 ? 2732 : 2703) : 2048);
    desc.isLightScreen = true;
  }

  if (defender.hasAbility('Multiscale', 'Shadow Shield') && defender.curHP() === defender.maxHP() &&
    hitCount === 0 &&
    !field.defenderSide.isSR && (!field.defenderSide.spikes || !isGrounded(defender, field)) &&
    !attacker.hasAbility('Parental Bond (Child)')) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (attacker.hasAbility('Tinted Lens') && typeEffectiveness < 1) {
    finalMods.push(8192);
    desc.attackerAbility = attacker.ability;
  }
  if (defender.hasAbility('Royal Guard') && defender.curHP() <= defender.maxHP() / 2) {
    finalMods.push(3072);
    desc.defenderAbility = defender.ability;
  }
  if (field.defenderSide.isFriendGuard) {
    finalMods.push(3072);
    desc.isFriendGuard = true;
  }

  if (attacker.hasAbility('Sniper') && isCritical) {
    finalMods.push(6144);
    desc.attackerAbility = attacker.ability;
  }

  if (defender.hasAbility('Solid Rock', 'Filter') && typeEffectiveness > 1) {
    finalMods.push(3072);
    desc.defenderAbility = defender.ability;
  }
  if (defender.hasAbility('Bagwormicade') && typeEffectiveness > 1) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }
  if (defender.hasAbility('Enfeebling Venom') && attacker.hasStatus('psn', 'tox')) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }
  if (attacker.hasItem('Metronome') && move.timesUsedWithMetronome! >= 1) {
    const timesUsedWithMetronome = Math.floor(move.timesUsedWithMetronome!);
    if (timesUsedWithMetronome <= 4) {
      finalMods.push(4096 + timesUsedWithMetronome * 819);
    } else {
      finalMods.push(8192);
    }
    desc.attackerItem = attacker.item;
  }

  if (attacker.hasItem('Expert Belt') && typeEffectiveness > 1 && !move.isZ) {
    finalMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem('Life Orb')) {
    finalMods.push(5324);
    desc.attackerItem = attacker.item;
  }

  if (move.hasType(getBerryResistType(defender.item)) &&
    (typeEffectiveness > 1 || move.hasType('Normal')) &&
    hitCount === 0 &&
    !attacker.hasAbility('Unnerve')) {
    finalMods.push(2048);
    desc.defenderItem = defender.item;
  }

  return finalMods;
}

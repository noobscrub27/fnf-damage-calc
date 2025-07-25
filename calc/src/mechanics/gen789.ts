import {Generation, AbilityName, StatID, Terrain} from '../data/interface';
import {toID} from '../util';
import {
  getBerryResistType,
  getFlingPower,
  getItemBoostType,
  getMultiAttack,
  getNaturalGift,
  getTechnoBlast,
  getOrbType,
  SEED_BOOSTED_STAT,
} from '../items';
import {RawDesc} from '../desc';
import {Field} from '../field';
import {Move} from '../move';
import {Pokemon} from '../pokemon';
import {Result} from '../result';
import {
  chainMods,
  checkAirLock,
  checkDauntlessShield,
  checkDownload,
  checkSearchEngine,
  checkSillySoda,
  checkInflate,
  checkEmbody,
  checkForecast,
  checkInfiltrator,
  checkScreenBreakers,
  checkIntimidate,
  checkIntrepidSword,
  checkItem,
  checkMultihitBoost,
  checkSeedBoost,
  checkTeraformZero,
  checkWonderRoom,
  computeFinalStats,
  checkForLoweredStat,
  countBoosts,
  getBaseDamage,
  getEVDescriptionText,
  getFinalDamage,
  getModifiedStat,
  getQPBoostedStat,
  getMoveEffectiveness,
  getShellSideArmCategory,
  getWeight,
  handleFixedDamageMoves,
  isGrounded,
  OF16, OF32,
  pokeRound,
  isQPActive,
  getStabMod,
  getStellarStabMod,
} from './util';

export function calculateSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field
) {
  // #region Initial

  checkAirLock(attacker, field);
  checkAirLock(defender, field);
  checkTeraformZero(attacker, field);
  checkTeraformZero(defender, field);
  checkForecast(attacker, field.weather);
  checkForecast(defender, field.weather);
  checkItem(attacker, field.isMagicRoom);
  checkItem(defender, field.isMagicRoom);
  checkWonderRoom(attacker, field.isWonderRoom);
  checkWonderRoom(defender, field.isWonderRoom);
  checkSeedBoost(attacker, field);
  checkSeedBoost(defender, field);
  checkDauntlessShield(attacker, gen);
  checkDauntlessShield(defender, gen);
  checkEmbody(attacker, gen);
  checkEmbody(defender, gen);
  checkSearchEngine(defender, attacker);
  checkSearchEngine(attacker, defender);
  checkInflate(attacker);
  checkInflate(defender);

  computeFinalStats(gen, attacker, defender, field, 'def', 'spd', 'spe');

  checkIntimidate(gen, attacker, defender);
  checkIntimidate(gen, defender, attacker);
  checkDownload(attacker, defender, field.isWonderRoom);
  checkDownload(defender, attacker, field.isWonderRoom);
  checkIntrepidSword(attacker, gen);
  checkIntrepidSword(defender, gen);
  checkSillySoda(attacker, gen);
  checkSillySoda(defender, gen);

  if (move.named('Meteor Beam', 'Electro Shot', 'Shadow Laser')) {
    attacker.boosts.spa +=
      attacker.hasAbility('Simple') ? 2
        : attacker.hasAbility('Contrary') ? -1
          : 1;
    // restrict to +- 6
    attacker.boosts.spa = Math.min(6, Math.max(-6, attacker.boosts.spa));
  }

  computeFinalStats(gen, attacker, defender, field, 'atk', 'spa');

  checkScreenBreakers(attacker, move, field.defenderSide);
  checkInfiltrator(attacker, field.defenderSide);
  checkInfiltrator(defender, field.attackerSide);

  const desc: RawDesc = {
    attackerName: attacker.name,
    attackerTera: attacker.teraType,
    moveName: move.name,
    defenderName: defender.name,
    defenderTera: defender.teraType,
    isDefenderDynamaxed: defender.isDynamaxed,
    isWonderRoom: field.isWonderRoom,
  };

  const result = new Result(gen, attacker, defender, move, field, 0, desc);

  if (move.category === 'Status' && !move.named('Nature Power')) {
    return result;
  }

  const breaksProtect = move.breaksProtect || move.isZ || attacker.isDynamaxed ||
    (attacker.hasAbility('Unseen Fist') && move.flags.contact);

  if (field.defenderSide.isProtected && !breaksProtect) {
    desc.isProtected = true;
    return result;
  }
  if (field.isMysteryRoom || attacker.hasAbility('Neutralizing Gas') || defender.hasAbility('Neutralizing Gas')) {
    defender.ability = '' as AbilityName;
    attacker.ability = '' as AbilityName;
  }
  const defenderIgnoresAbility = defender.hasAbility('Full Metal Body', 'Neutralizing Gas', 'Prism Armor', 'Shadow Shield');
  const attackerIgnoresAbility = attacker.hasAbility('Mold Breaker', 'Teravolt', 'Turboblaze');
  const moveIgnoresAbility = move.named(
    'G-Max Drum Solo',
    'G-Max Fire Ball',
    'G-Max Hydrosnipe',
    'Light That Burns the Sky',
    'Menacing Moonraze Maelstrom',
    'Moongeist Beam',
    'Photon Geyser',
    'Searing Sunraze Smash',
    'Sunsteel Strike',
    'Shadow Titan'
  );
  if (!defenderIgnoresAbility && !defender.hasAbility('Poison Heal') &&
    (attackerIgnoresAbility || moveIgnoresAbility)) {
    if (attackerIgnoresAbility) desc.attackerAbility = attacker.ability;
    if (defender.hasItem('Ability Shield')) {
      desc.defenderItem = defender.item;
    } else {
      defender.ability = '' as AbilityName;
    }
  }

  // Merciless does not ignore Shell Armor, damage dealt to a poisoned Pokemon with Shell Armor
  // will not be a critical hit (UltiMario)
  const isCritical = !defender.hasAbility('Battle Armor', 'Shell Armor') && !(defender.hasAbility('Pure Heart', 'Shadow Armor') && move.hasType('Shadow')) &&
    (move.isCrit || (attacker.named('Chansey') && attacker.hasItem('Lucky Punch') && move.flags.punch === 1) || (attacker.hasAbility('Merciless') && defender.hasStatus('psn', 'tox'))) &&
    move.timesUsed === 1;

  let type = move.type;
  if (move.named('Weather Ball')) {
    const holdingUmbrella = attacker.hasItem('Utility Umbrella');
    type =
      field.hasWeather('Sun', 'Harsh Sunshine') && !holdingUmbrella ? 'Fire'
        : field.hasWeather('Rain', 'Heavy Rain') && !holdingUmbrella ? 'Water'
          : field.hasWeather('Sand') ? 'Rock'
            : field.hasWeather('Hail', 'Snow') ? 'Ice'
              : field.hasWeather('Shadow Sky') ? 'Shadow'
                : 'Normal';
    desc.weather = field.weather;
    desc.moveType = type;
  } else if (move.named('Judgment') && attacker.item && attacker.item.includes('Plate')) {
    type = getItemBoostType(attacker.item)!;
  } else if (move.named('Primal Burst') && attacker.item && attacker.item.includes('Orb')) {
    type = getOrbType(attacker.item)!;
  } else if (move.named('Techno Blast') && attacker.item && attacker.item.includes('Drive')) {
    type = getTechnoBlast(attacker.item)!;
  } else if (move.named('Multi-Attack') && attacker.item && attacker.item.includes('Memory')) {
    type = getMultiAttack(attacker.item)!;
  } else if (move.named('Natural Gift') && attacker.item && attacker.item.endsWith('Berry')) {
    const gift = getNaturalGift(gen, attacker.item)!;
    type = gift.t;
    desc.moveType = type;
    desc.attackerItem = attacker.item;
  } else if (
    move.named('Nature Power') ||
    (move.named('Terrain Pulse') && isGrounded(attacker, field))
  ) {
    type =
      field.hasTerrain('Electric') ? 'Electric'
        : field.hasTerrain('Grassy') ? 'Grass'
          : field.hasTerrain('Misty') ? 'Fairy'
            : field.hasTerrain('Psychic') ? 'Psychic'
              : field.hasTerrain('Berserk') ? 'Dragon'
                : 'Normal';
    desc.terrain = field.terrain;
    desc.moveType = type;
  } else if (move.named('Revelation Dance')) {
    if (attacker.teraType) {
      type = attacker.teraType;
    } else {
      type = attacker.types[0];
    }
  } else if (move.named('Aura Wheel')) {
    if (attacker.named('Morpeko')) {
      type = 'Electric';
    } else if (attacker.named('Morpeko-Hangry')) {
      type = 'Dark';
    }
  } else if (move.named('Seasonal Spirit')) {
    if (attacker.named('Sawsbuck-Spring')) {
      type = 'Fairy';
    } else if (attacker.named('Sawsbuck-Summer')) {
      type = 'Fire';
    } else if (attacker.named('Sawsbuck-Autumn')) {
      type = 'Ground';
    } else if (attacker.named('Sawsbuck-Winter')) {
      type = 'Ice';
    }
  } else if (move.named('Raging Bull')) {
    if (attacker.named('Tauros-Paldea-Combat')) {
      type = 'Fighting';
    } else if (attacker.named('Tauros-Paldea-Blaze')) {
      type = 'Fire';
    } else if (attacker.named('Tauros-Paldea-Aqua')) {
      type = 'Water';
    }
  } else if (move.named('Ivy Cudgel')) {
    if (attacker.name.includes('Ogerpon-Cornerstone')) {
      type = 'Rock';
    } else if (attacker.name.includes('Ogerpon-Hearthflame')) {
      type = 'Fire';
    } else if (attacker.name.includes('Ogerpon-Wellspring')) {
      type = 'Water';
    }
  }

  let hasAteAbilityTypeChange = false;
  let isAerilate = false;
  let isPixilate = false;
  let isRefrigerate = false;
  let isGalvanize = false;
  let isLiquidVoice = false;
  let isNormalize = false;
  let isMalevolate = false;
  let isToxicate = false;
  let isDraconize = false;
  const noTypeChange = move.named(
    'Revelation Dance',
    'Judgment',
    'Nature Power',
    'Techno Blast',
    'Multi Attack',
    'Natural Gift',
    'Weather Ball',
    'Terrain Pulse',
    'Struggle',
  ) || (move.named('Tera Blast') && attacker.teraType);

  if (!move.isZ && !noTypeChange) {
    const normal = move.hasType('Normal');
    if ((isAerilate = attacker.hasAbility('Aerilate') && normal)) {
      type = 'Flying';
    } else if ((isGalvanize = attacker.hasAbility('Galvanize') && normal)) {
      type = 'Electric';
    } else if ((isLiquidVoice = attacker.hasAbility('Liquid Voice') && !!move.flags.sound)) {
      type = 'Water';
    } else if ((isPixilate = attacker.hasAbility('Pixilate') && normal)) {
      type = 'Fairy';
    } else if ((isMalevolate = attacker.hasAbility('Malevolate') && normal)) {
      type = 'Dark';
    } else if ((isDraconize = attacker.hasAbility('Draconize') && normal)) {
      type = 'Dragon';
    } else if ((isRefrigerate = attacker.hasAbility('Refrigerate') && normal)) {
      type = 'Ice';
    } else if ((isToxicate = attacker.hasAbility('Toxicate') && normal)) {
      type = 'Poison';
    } else if ((isNormalize = attacker.hasAbility('Normalize'))) { // Boosts any type
      type = 'Normal';
    }
    if (isGalvanize || isPixilate || isRefrigerate || isAerilate || isToxicate || isMalevolate || isDraconize || isNormalize) {
      desc.attackerAbility = attacker.ability;
      hasAteAbilityTypeChange = true;
    } else if (isLiquidVoice) {
      desc.attackerAbility = attacker.ability;
    }
  }

  if (move.named('Tera Blast') && attacker.teraType) {
    type = attacker.teraType;
  }

  move.type = type;

  if (attacker.hasAbility('Cunning Blade') && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }

  // FIXME: this is incorrect, should be move.flags.heal, not move.drain
  if ((attacker.hasAbility('Triage') && move.drain) ||
    (attacker.hasAbility('Gale Wings') &&
      move.hasType('Flying') &&
      attacker.curHP() > attacker.maxHP()) ||
    (attacker.hasAbility('Melody Allegretto') && move.flags.sound)) {
    move.priority = 1;
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Stall')) {
    move.priority = -1;
    desc.attackerAbility = attacker.ability;
  }

  const isGhostRevealed =
    attacker.hasAbility('Scrappy') || attacker.hasAbility('Mind\'s Eye') ||
    field.defenderSide.isForesight;
  const isDarkRevealed = field.defenderSide.isMiracleEye || attacker.hasAbility('Psyche Control');
  const isRingTarget =
    defender.hasItem('Ring Target') && !defender.hasAbility('Klutz');
  const isBoneMaster = attacker.hasAbility('Bone Master') && !!move.flags.bone;
  const type1Effectiveness = getMoveEffectiveness(
    gen,
    move,
    defender.types[0],
    isGhostRevealed,
    isDarkRevealed,
    field.isGravity,
    isRingTarget,
    isBoneMaster
  );
  const type2Effectiveness = defender.types[1]
    ? getMoveEffectiveness(
      gen,
      move,
      defender.types[1],
      isGhostRevealed,
      isDarkRevealed,
      field.isGravity,
      isRingTarget,
      isBoneMaster
    )
    : 1;
  let typeEffectiveness = type1Effectiveness * type2Effectiveness;

  if (defender.teraType && defender.teraType !== 'Stellar') {
    typeEffectiveness = getMoveEffectiveness(
      gen,
      move,
      defender.teraType,
      isGhostRevealed,
      isDarkRevealed,
      field.isGravity,
      isRingTarget,
      isBoneMaster
    );
  }

  if (typeEffectiveness === 0 && move.hasType('Ground') &&
    defender.hasItem('Iron Ball') && !defender.hasAbility('Klutz')) {
    typeEffectiveness = 1;
  }

  if (typeEffectiveness === 0 && move.named('Thousand Arrows')) {
    typeEffectiveness = 1;
  }

  if (typeEffectiveness === 0) {
    return result;
  }

  if ((move.named('Sky Drop') &&
    (defender.hasType('Flying') || defender.weightkg >= 200 || field.isGravity)) ||
    (move.named('Dream Eater') &&
      (!(defender.hasStatus('slp') || defender.hasAbility('Comatose')))) ||
    (move.named('Steel Roller') && !field.terrain) ||
    (move.named('Poltergeist') && (!defender.item || isQPActive(defender, field)))
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

  if (move.type === 'Stellar') {
    typeEffectiveness = !defender.teraType ? 1 : 2;
  }
  const turn2typeEffectiveness = typeEffectiveness;
  // Tera Shell works only at full HP, but for all hits of multi-hit moves
  if (defender.hasAbility('Tera Shell') &&
    defender.curHP() === defender.maxHP() &&
    (!field.defenderSide.isSR && (!field.defenderSide.spikes || defender.hasType('Flying')) ||
      defender.hasItem('Heavy-Duty Boots'))
  ) {
    typeEffectiveness = 0.5;
    desc.defenderAbility = defender.ability;
  }

  if ((defender.hasAbility('Wonder Guard') && typeEffectiveness <= 1) ||
    (move.hasType('Grass') && defender.hasAbility('Sap Sipper')) ||
    (move.hasType('Fire') && defender.hasAbility('Flash Fire', 'Flame Absorb', 'Well-Baked Body', 'Shadow Convection')) ||
    (move.hasType('Water') && defender.hasAbility('Dry Skin', 'Storm Drain', 'Water Absorb', 'Shadow Hydraulics', 'Water Compation')) ||
    (move.hasType('Bug') && defender.hasAbility('Bugcatcher')) ||
    (move.hasType('Ground') && defender.hasAbility('Clay Construction')) ||
    (move.hasType('Ghost') && defender.hasAbility('Soul Lantern')) ||
    (move.hasType('Ice') && defender.hasAbility('Tropical Current')) ||
    (move.hasType('Electric') &&
      defender.hasAbility('Lightning Rod', 'Motor Drive', 'Volt Absorb', 'Shadow Conduction')) ||
    (move.hasType('Ground') && !field.isGravity && !move.named('Thousand Arrows') && !defender.hasItem('Iron Ball') &&
      // bone master does not go break through abilities other than inflate and levitate
      ((!(attacker.hasAbility('Bone Master') && move.flags.bone) &&
        (defender.hasAbility('Levitate') || (defender.hasAbility('Inflate') && defender.abilityOn))) ||
        (defender.named('Probopass') && defender.hasItem('Magnetic Stone')))) ||
    (move.flags.bullet && defender.hasAbility('Bulletproof')) ||
    (move.flags.blade && defender.hasAbility('Bladeproof')) ||
    (move.flags.sound && !move.named('Clangorous Soul') && defender.hasAbility('Soundproof')) ||
    (move.priority > 0 && defender.hasAbility('Queenly Majesty', 'Dazzling', 'Armor Tail')) ||
    (move.hasType('Ground') && defender.hasAbility('Earth Eater')) ||
    (move.flags.wind && defender.hasAbility('Wind Rider', 'Jetstream')) ||
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

  const weightBasedMove = move.named('Heat Crash', 'Heavy Slam', 'Low Kick', 'Grass Knot', 'Shadow Avil', 'Shadow Trip');
  if (defender.isDynamaxed && weightBasedMove) {
    return result;
  }

  desc.HPEVs = `${defender.evs.hp} HP`;

  const fixedDamage = handleFixedDamageMoves(attacker, move);
  if (fixedDamage) {
    result.damage = fixedDamage;
    return result;
  }

  if (move.named('Final Gambit')) {
    result.damage = attacker.curHP();
    return result;
  }

  if (move.named('Guardian of Alola')) {
    let zLostHP = Math.floor((defender.curHP() * 3) / 4);
    if (field.defenderSide.isProtected && attacker.item && attacker.item.includes(' Z')) {
      zLostHP = Math.ceil(zLostHP / 4 - 0.5);
    }
    result.damage = zLostHP;
    return result;
  }

  if (move.named('Nature\'s Madness')) {
    const lostHP = field.defenderSide.isProtected ? 0 : Math.floor(defender.curHP() / 2);
    result.damage = lostHP;
    return result;
  }

  if (move.named('Spectral Thief', 'Cat Burglary', 'Rapid Raidswipe')) {
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

  const turnOrder = attacker.stats.spe > defender.stats.spe ? 'first' : 'last';

  // #endregion
  // #region Base Power

  const basePower = calculateBasePowerSMSSSV(
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
  const attack = calculateAttackSMSSSV(gen, attacker, defender, move, field, desc, isCritical);
  const attackSource = move.named('Foul Play', 'Shadow Duplicity') ? defender : attacker;
  if (move.named('Photon Geyser', 'Light That Burns the Sky') ||
    (move.named('Tera Blast') && attackSource.teraType)) {
    move.category = attackSource.stats.atk > attackSource.stats.spa ? 'Physical' : 'Special';
  }
  const attackStat =
    move.named('Shell Side Arm') &&
      getShellSideArmCategory(attacker, defender) === 'Physical'
      ? 'atk'
      : move.named('Body Press', 'Shadow Press')
        ? 'def'
        : move.category === 'Special'
          ? 'spa'
          : 'atk';
  // #endregion
  // #region (Special) Defense
  const defense = calculateDefenseSMSSSV(gen, attacker, defender, move, field, desc, isCritical);
  const hitsPhysical = move.overrideDefensiveStat !== 'spd' &&
    (move.overrideDefensiveStat === 'def' || move.category === 'Physical' ||
      (move.named('Shell Side Arm') && getShellSideArmCategory(attacker, defender) === 'Physical'));
  const defenseStat = hitsPhysical ? 'def' : 'spd';

  // #endregion
  // #region Damage

  const baseDamage = calculateBaseDamageSMSSSV(
    gen,
    attacker,
    defender,
    basePower,
    attack,
    defense,
    move,
    field,
    desc,
    isCritical
  );

  if (hasTerrainSeed(defender) &&
    field.hasTerrain(defender.item!.substring(0, defender.item!.indexOf(' ')) as Terrain) &&
    SEED_BOOSTED_STAT[defender.item!] === defenseStat) {
    // Last condition applies so the calc doesn't show a seed where it wouldn't affect the outcome
    // (like Grassy Seed when being hit by a special move)
    desc.defenderItem = defender.item;
  }

  // the random factor is applied between the crit mod and the stab mod, so don't apply anything
  // below this until we're inside the loop
  let preStellarStabMod = getStabMod(attacker, move, desc);
  let stabMod = getStellarStabMod(attacker, move, preStellarStabMod);

  const applyBurn =
    attacker.hasStatus('brn') &&
    move.category === 'Physical' &&
    !attacker.hasAbility('Guts') &&
    !move.named('Facade', 'Shadow Rage');
  desc.isBurned = applyBurn;
  const applyFreeze =
    attacker.hasStatus('frz') &&
    move.category === 'Special';
  desc.isFrozen = applyFreeze;
  const statusReducesDamage = applyBurn || applyFreeze;
  const finalMods = calculateFinalModsSMSSSV(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    isCritical,
    typeEffectiveness
  );

  let protect = false;
  if (field.defenderSide.isProtected &&
    (attacker.isDynamaxed || (move.isZ && attacker.item && attacker.item.includes(' Z')))) {
    protect = true;
    desc.isProtected = true;
  }

  const finalMod = chainMods(finalMods, 41, 131072);

  const isSpread = field.gameType !== 'Singles' &&
    ['allAdjacent', 'allAdjacentFoes'].includes(move.target);

  let childDamage: number[] | undefined;
  if (attacker.hasAbility('Parental Bond') && move.hits === 1 && !isSpread) {
    const child = attacker.clone();
    child.ability = 'Parental Bond (Child)' as AbilityName;
    checkMultihitBoost(gen, child, defender, move, field, desc);
    childDamage = calculateSMSSSV(gen, child, defender, move, field).damage as number[];
    desc.attackerAbility = attacker.ability;
  }

  let damage = [];
  for (let i = 0; i < 16; i++) {
    damage[i] =
      getFinalDamage(baseDamage, i, typeEffectiveness, statusReducesDamage, stabMod, finalMod, protect);
  }

  desc.attackBoost =
    move.named('Foul Play', 'Shadow Duplicity') ? defender.boosts[attackStat] : attacker.boosts[attackStat];

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
      const newAttack = calculateAttackSMSSSV(gen, attacker, defender, move,
        field, desc, isCritical);
      const newDefense = calculateDefenseSMSSSV(gen, attacker, defender, move,
        field, desc, isCritical);
      // Check if lost -ate ability. Typing stays the same, only boost is lost
      // Cannot be regained during multihit move and no Normal moves with stat drawbacks
      hasAteAbilityTypeChange = hasAteAbilityTypeChange &&
        attacker.hasAbility('Aerilate', 'Galvanize', 'Pixilate', 'Refrigerate', 'Normalize', 'Malevolate', 'Draconize', 'Toxicate');

      if ((move.dropsStats && move.timesUsed! > 1)) {
        // Adaptability does not change between hits of a multihit, only between turns
        preStellarStabMod = getStabMod(attacker, move, desc);
        // Hack to make Tera Shell with multihit moves, but not over multiple turns
        typeEffectiveness = turn2typeEffectiveness;
        // Stellar damage boost applies for 1 turn, but all hits of multihit.
        stabMod = getStellarStabMod(attacker, move, preStellarStabMod, times);
      }
      const newBasePower = calculateBasePowerSMSSSV(
        gen,
        attacker,
        defender,
        move,
        field,
        hasAteAbilityTypeChange,
        desc,
        times + 1
      );
      const newBaseDamage = calculateBaseDamageSMSSSV(
        gen,
        attacker,
        defender,
        newBasePower,
        newAttack,
        newDefense,
        move,
        field,
        desc,
        isCritical
      );
      const newFinalMods = calculateFinalModsSMSSSV(
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
          newFinalMod,
          protect
        );
        damageMultiplier++;
        return affectedAmount + newFinalDamage;
      });
      desc.defenseBoost = origDefBoost;
      desc.attackBoost = origAtkBoost;
    }
  }

  result.damage = childDamage ? [damage, childDamage] : damage;

  // #endregion

  return result;
}

export function calculateBasePowerSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  hasAteAbilityTypeChange: boolean,
  desc: RawDesc,
  hit = 1
) {
  const turnOrder = attacker.stats.spe > defender.stats.spe ? 'first' : 'last';

  let basePower: number;

  switch (move.name) {
    case 'Payback':
      basePower = move.bp * (turnOrder === 'last' ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Bolt Beak':
    case 'Fishious Rend':
      basePower = move.bp * (turnOrder !== 'last' ? 2 : 1);
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
      const r = Math.floor(attacker.stats.spe / defender.stats.spe);
      basePower = r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40;
      if (defender.stats.spe === 0) basePower = 40;
      desc.moveBP = basePower;
      break;
    case 'Gyro Ball':
    case 'Shadow Centrifuge':
      basePower = Math.min(150, Math.floor((25 * defender.stats.spe) / attacker.stats.spe) + 1);
      if (attacker.stats.spe === 0) basePower = 1;
      desc.moveBP = basePower;
      break;
    case 'Punishment':
      basePower = Math.min(200, 60 + 20 * countBoosts(gen, defender.boosts));
      desc.moveBP = basePower;
      break;
    case 'Creeping Despair':
    case 'Shadow Desolation':
      basePower = Math.floor(move.bp * (checkForLoweredStat(gen, defender.boosts) ? 1.5 : 1));
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
      // Hex deals double damage to Pokemon with Comatose (ih8ih8sn0w)
      basePower = move.bp * (defender.status || defender.hasAbility('Comatose') ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Sparkling Aria':
      basePower = move.bp * (defender.status || defender.hasAbility('Comatose') ? 1.5 : 1);
      desc.moveBP = basePower;
      break;
    case 'Barb Barrage':
      basePower = move.bp * (defender.hasStatus('psn', 'tox') ? 2 : 1);
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
      basePower = move.bp * (attacker.hasItem('Flying Gem') ||
        (!attacker.item || isQPActive(attacker, field)) ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Assurance':
      basePower = move.bp * (defender.hasAbility('Parental Bond (Child)') ? 2 : 1);
      // NOTE: desc.attackerAbility = 'Parental Bond' will already reflect this boost
      break;
    case 'Wake-Up Slap':
      // Wake-Up Slap deals double damage to Pokemon with Comatose (ih8ih8sn0w)
      basePower = move.bp * (defender.hasStatus('slp') || defender.hasAbility('Comatose') ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Smelling Salts':
      basePower = move.bp * (defender.hasStatus('par') ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Weather Ball':
      basePower = move.bp * (field.weather && !field.hasWeather('Strong Winds') ? 2 : 1);
      if (field.hasWeather('Sun', 'Harsh Sunshine', 'Rain', 'Heavy Rain', 'Miasma', 'Shadow Sky') &&
        attacker.hasItem('Utility Umbrella')) basePower = move.bp;
      desc.moveBP = basePower;
      break;
    case 'Terrain Pulse':
      basePower = move.bp * (isGrounded(attacker, field) && field.terrain ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Rising Voltage':
      basePower = move.bp * ((isGrounded(defender, field) && field.hasTerrain('Electric')) ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Psyblade':
      basePower = move.bp * (field.hasTerrain('Electric') ? 1.5 : 1);
      if (field.hasTerrain('Electric')) {
        desc.moveBP = basePower;
        desc.terrain = field.terrain;
      }
      break;
    case 'Fling':
      basePower = getFlingPower(attacker.item);
      desc.moveBP = basePower;
      desc.attackerItem = attacker.item;
      break;
    case 'Dragon Energy':
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
    case 'Natural Gift':
      if (attacker.item?.includes('Berry')) {
        const gift = getNaturalGift(gen, attacker.item)!;
        basePower = gift.p;
        desc.attackerItem = attacker.item;
        desc.moveBP = move.bp;
      } else {
        basePower = move.bp;
      }
      break;
    case 'Nature Power':
      move.category = 'Special';
      move.secondaries = true;
      // Nature Power cannot affect Dark-types if it is affected by Prankster
      if (attacker.hasAbility('Prankster') && defender.types.includes('Dark')) {
        basePower = 0;
        desc.moveName = 'Nature Power';
        desc.attackerAbility = 'Prankster';
        break;
      }
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
          basePower = 90;
          desc.moveName = 'Moonblast';
          break;
        case 'Berserk':
          basePower = 90;
          desc.moveName = 'Dragon Pulse';
          break;
        case 'Psychic':
          // Nature Power does not affect grounded Pokemon if it is affected by
          // Prankster and there is Psychic Terrain active
          if (attacker.hasAbility('Prankster') && isGrounded(defender, field)) {
            basePower = 0;
            desc.attackerAbility = 'Prankster';
          } else {
            basePower = 90;
            desc.moveName = 'Psychic';
          }
          break;
        default:
          basePower = 80;
          desc.moveName = 'Tri Attack';
      }
      break;
    case 'Water Shuriken':
      basePower = attacker.named('Greninja-Ash') && attacker.hasAbility('Battle Bond') ? 20 : 15;
      desc.moveBP = basePower;
      break;
    // Triple Axel's damage doubles after each consecutive hit (20, 40, 60)
    case 'Triple Axel':
    case 'Triple Kick':
      basePower = hit * 20;
      desc.moveBP = move.hits === 2 ? 60 : move.hits === 3 ? 120 : 20;
      break;
    case 'Crush Grip':
      basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
      basePower = Math.floor(Math.floor((180 * basePower + 2048 - 1) / 4096) / 100) || 1;
      desc.moveBP = basePower;
      break;
    case 'Wring Out':
    case 'Shadow Squeeze':
      basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
      basePower = Math.floor(Math.floor((120 * basePower + 2048 - 1) / 4096) / 100) || 1;
      desc.moveBP = basePower;
      break;
    case 'Synchronoise':
      basePower = move.bp * ((defender.hasType(attacker.types[0]) || (attacker.types[1] && defender.hasType(attacker.types[1]))) ? 2 : 1);
      desc.moveBP = basePower;
      break;
    case 'Hard Press':
      basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
      basePower = Math.floor(Math.floor((120 * basePower + 2048 - 1) / 4096) / 100) || 1;
      desc.moveBP = basePower;
      break;
    case 'Tera Blast':
      basePower = attacker.teraType === 'Stellar' ? 100 : 80;
      desc.moveBP = basePower;
      break;
    default:
      basePower = move.bp;
  }
  if (basePower === 0) {
    return 0;
  }
  if (move.named(
    'Breakneck Blitz', 'Bloom Doom', 'Inferno Overdrive', 'Hydro Vortex', 'Gigavolt Havoc',
    'Subzero Slammer', 'Supersonic Skystrike', 'Savage Spin-Out', 'Acid Downpour', 'Tectonic Rage',
    'Continental Crush', 'All-Out Pummeling', 'Shattered Psyche', 'Never-Ending Nightmare',
    'Devastating Drake', 'Black Hole Eclipse', 'Corkscrew Crash', 'Twinkle Tackle'
  )) {
    // show z-move power in description
    desc.moveBP = move.bp;
  }
  const bpMods = calculateBPModsSMSSSV(
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
  if (
    attacker.teraType && move.type === attacker.teraType &&
    attacker.hasType(attacker.teraType) && move.hits === 1 &&
    move.priority <= 0 && move.bp > 0 && !move.named('Dragon Energy', 'Eruption', 'Water Spout') &&
    basePower < 60 && gen.num >= 9
  ) {
    basePower = 60;
    desc.moveBP = 60;
  }
  return basePower;
}

export function calculateBPModsSMSSSV(
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

  // Move effects

  // For some reason this code needs to be repeated in this function or Battery and Wise Glasses dont work
  if (attacker.hasAbility('Cunning Blade') && move.category === 'Physical' && move.flags.blade) {
    move.category = 'Special';
    move.flags.contact = 0;
  }

  let resistedKnockOffDamage =
    (!defender.item || isQPActive(defender, field)) ||
    (defender.named('Dialga-Origin') && defender.hasItem('Adamant Crystal')) ||
    (defender.named('Palkia-Origin') && defender.hasItem('Lustrous Globe')) ||
    // Griseous Core for gen 9, Griseous Orb otherwise
    (defender.name.includes('Giratina-Origin') && defender.item.includes('Griseous')) ||
    (defender.name.includes('Arceus') && defender.item.includes('Plate')) ||
    (defender.name.includes('Genesect') && defender.item.includes('Drive')) ||
    (defender.named('Groudon', 'Groudon-Primal') && defender.hasItem('Red Orb')) ||
    (defender.named('Kyogre', 'Kyogre-Primal') && defender.hasItem('Blue Orb')) ||
    (defender.name.includes('Silvally') && defender.item.includes('Memory')) ||
    defender.item.includes(' Z') ||
    (defender.named('Zacian') && defender.hasItem('Rusted Sword')) ||
    (defender.named('Zamazenta') && defender.hasItem('Rusted Shield')) ||
    (defender.name.includes('Ogerpon-Cornerstone') && defender.hasItem('Cornerstone Mask')) ||
    (defender.name.includes('Ogerpon-Hearthflame') && defender.hasItem('Hearthflame Mask')) ||
    (defender.name.includes('Ogerpon-Wellspring') && defender.hasItem('Wellspring Mask')) ||
    (defender.named('Venomicon-Epilogue') && defender.hasItem('Vile Vial')) ||
    (defender.named('Kiwuit') && defender.hasAbility('Ambrosia') && defender.item && gen.items.get(toID(defender.item))!.isBerry) ||
    (defender.named('Meganium') && defender.hasItem('Fragrant Herb')) ||
    (defender.named('Pyukumuku') && defender.hasItem('Strange Mucus')) ||
    (defender.named('Tropius') && defender.hasItem('Banana Bunch')) ||
    (defender.named('Shedinja') && defender.hasItem('Cursed Crown')) ||
    (defender.named('Marowak', 'Cubone', 'Marowak-Alola', 'Cubone-Alola') && defender.hasItem('Thick Club')) ||
    (defender.named('Pikachu') && defender.hasItem('Light Ball')) ||
    (defender.named('Meowth') && defender.hasItem('Amulet Coin')) ||
    (defender.named('Happiny') && defender.hasItem('Oval Stone')) ||
    (defender.named('Chansey') && defender.hasItem('Lucky Punch')) ||
    (defender.named('Probopass') && defender.hasItem('Magnetic Stone')) ||
    (defender.named('Osteoskhan') && defender.hasItem('Bone Baton')) ||
    (defender.named('Spinda') && defender.hasItem('Silly Soda')) ||
    (defender.named('Darmanitan', 'Darmanizen', 'Darmanitan-Zen') && defender.hasItem('Calm Candy Bar')) ||
    (defender.named('Gallade') && defender.hasItem('Knight\'s Edge')) ||
    (defender.named('Absol') && defender.hasItem('Night\'s Edge')) ||
    (defender.name.includes('Vespiquen') && defender.hasItem('Royal Jelly')) ||
    (defender.named('Feebas-Vanessa') && defender.hasItem('Precious Scale')) ||
    (defender.name.includes('Meowth') && defender.hasItem('Amulet Coin')) ||
    (defender.named('Farfetch\u2019d', 'Madamme') && defender.hasItem('Stick')) ||
    (defender.named('Magmortar') && defender.hasItem('Magmarizer')) ||
    (defender.named('Electivire') && defender.hasItem('Electirizer')) ||
    (defender.name.includes('Cherrim') && defender.hasItem('Cerise Orb')) ||
    (defender.name.includes('Phione') && defender.hasItem('Teal Orb')) ||
    (defender.name.includes('Omniverum') && defender.hasItem('Truth Splicer', 'Ideals Splicer')) ||
    (defender.name.includes('Regigigas') && defender.hasItem('Craftsman Orb')) ||
    (defender.named('Vespiquen-Armored') && defender.hasItem('Vespiquen Armor')) ||
    (defender.named('Toxicroak-Armored') && defender.hasItem('Toxicroak Armor')) ||
    (defender.named('Roserade-Armored') && defender.hasItem('Roserade Armor')) ||
    (defender.named('Magcargo-Armored') && defender.hasItem('Magcargo Armor')) ||
    (defender.named('Ivysaur-Armored') && defender.hasItem('Ivysaur Armor')) ||
    (defender.named('Goomy-Armored') && defender.hasItem('Goomy Armor')) ||
    (defender.named('Teddiursa-Armored') && defender.hasItem('Teddiursa Armor')) ||
    (defender.named('Typhlosion-Armored') && defender.hasItem('Typhlosion Armor')) ||
    (defender.named('Nuzleaf-Armored') && defender.hasItem('Nuzleaf Armor')) ||
    (defender.named('Steenee-Delta-Armored') && defender.hasItem('Steenee-Delta Armor')) ||
    (defender.named('Chingling-Armored') && defender.hasItem('Chingling Armor')) ||
    (defender.named('Kirlia-Armored', 'Kirlia-Armored-Weaver') && defender.hasItem('Kirlia Armor')) ||
    (defender.named('Granbull-Armored') && defender.hasItem('Granbull Armor')) ||
    (defender.named('Granbull-Nobunaga') && defender.hasItem('Nobunaga Armor')) ||
    (defender.named('Ignajara-Armored') && defender.hasItem('Ignajara Armor')) ||
    (defender.named('Dragonair-Armored') && defender.hasItem('Dragonair Armor')) ||
    (defender.named('Primeape-Armored') && defender.hasItem('Primeape Armor')) ||
    (defender.named('Mewtwo-Armored') && defender.hasItem('Mewtwo Armor')) ||
    (defender.name.includes('Castform') && defender.hasItem('Heat Rock', 'Icy Rock', 'Damp Rock', 'Mordant Rock', 'Smooth Rock', 'Corrupted Rock'));

  // The last case only applies when the Pokemon has the Mega Stone that matches its species
  // (or when it's already a Mega-Evolution)
  // Alarix breaks naming conventions so it's hardcoded
  if (!resistedKnockOffDamage && defender.item) {
    const item = gen.items.get(toID(defender.item))!;
    resistedKnockOffDamage = !!item.megaEvolves && defender.name.includes(item.megaEvolves) ||
      (defender.named('Gyarados-Alarix', 'Gyarados-Mega-Alarix') && defender.hasItem('Alarixite'));
  }

  if ((move.named('Facade', 'Shadow Rage') && attacker.hasStatus('brn', 'par', 'psn', 'tox', 'frz')) ||
    (move.named('Brine') && defender.curHP() <= defender.maxHP() / 2) ||
    (move.named('Venoshock') && defender.hasStatus('psn', 'tox')) ||
    (move.named('Lash Out') && (countBoosts(gen, attacker.boosts) < 0))
  ) {
    bpMods.push(8192);
    desc.moveBP = basePower * 2;
  } else if (
    move.named('Expanding Force') && isGrounded(attacker, field) && field.hasTerrain('Psychic')
  ) {
    move.target = 'allAdjacentFoes';
    bpMods.push(6144);
    desc.moveBP = basePower * 1.5;
  } else if (
    move.named('Tera Starstorm') && attacker.name === 'Terapagos-Stellar'
  ) {
    move.target = 'allAdjacentFoes';
    move.type = 'Stellar';
  } else if ((move.named('Knock Off') && !resistedKnockOffDamage) ||
    (move.named('Misty Explosion') && isGrounded(attacker, field) && field.hasTerrain('Misty')) ||
    (move.named('Zing Zap') && defender.hasStatus('par')) ||
    (move.named('Grav Apple') && field.isGravity)
  ) {
    bpMods.push(6144);
    desc.moveBP = basePower * 1.5;
  } else if (move.named('Solar Beam', 'Solar Blade') &&
    field.hasWeather('Rain', 'Heavy Rain', 'Sand', 'Hail', 'Snow', 'Miasma')) {
    bpMods.push(2048);
    desc.moveBP = basePower / 2;
    desc.weather = field.weather;
  } else if (move.named('Collision Course', 'Electro Drift')) {
    const isGhostRevealed =
      attacker.hasAbility('Scrappy') || attacker.hasAbility('Mind\'s Eye') ||
      field.defenderSide.isForesight;
    const isRingTarget =
      defender.hasItem('Ring Target') && !defender.hasAbility('Klutz');
    const isBoneMaster = attacker.hasAbility('Bone Master') && !!move.flags.bone;
    const types = defender.teraType ? [defender.teraType] : defender.types;
    const type1Effectiveness = getMoveEffectiveness(
      gen,
      move,
      types[0],
      isGhostRevealed,
      field.isGravity,
      isRingTarget,
      isBoneMaster
    );
    const type2Effectiveness = types[1] ? getMoveEffectiveness(
      gen,
      move,
      types[1],
      isGhostRevealed,
      field.isGravity,
      isRingTarget,
      isBoneMaster
    ) : 1;
    if (type1Effectiveness * type2Effectiveness >= 2) {
      bpMods.push(5461);
      desc.moveBP = basePower * (5461 / 4096);
    }
  }

  if (field.attackerSide.isHelpingHand) {
    bpMods.push(6144);
    desc.isHelpingHand = true;
  }

  // Field effects

  const terrainMultiplier = gen.num > 7 ? 5325 : 6144;
  if (isGrounded(attacker, field)) {
    if ((field.hasTerrain('Electric') && move.hasType('Electric')) ||
      (field.hasTerrain('Grassy') && move.hasType('Grass')) ||
      (field.hasTerrain('Psychic') && move.hasType('Psychic'))
    ) {
      bpMods.push(terrainMultiplier);
      desc.terrain = field.terrain;
    }
  }
  if (isGrounded(defender, field)) {
    if ((field.hasTerrain('Misty') && move.hasType('Dragon')) ||
      (field.hasTerrain('Berserk') && move.hasType('Fairy')) ||
      (field.hasTerrain('Grassy') && move.named('Bulldoze', 'Earthquake'))
    ) {
      bpMods.push(2048);
      desc.terrain = field.terrain;
    }
  }

  // Abilities

  // Use BasePower after moves with custom BP to determine if Technician should boost
  if ((attacker.hasAbility('Technician') && basePower <= 60) ||
    (attacker.hasAbility('Flare Boost') &&
      attacker.hasStatus('brn') && move.category === 'Special') ||
    (attacker.hasAbility('Mega Launcher') && move.flags.pulse) ||
    (attacker.hasAbility('Strong Jaw') && move.flags.bite) ||
    (attacker.hasAbility('Steely Spirit') && move.hasType('Steel')) ||
    (attacker.hasAbility('Sharpness') && move.flags.slicing) ||
    (attacker.hasAbility('Escape Artist') && move.named('Flip Turn', 'U-turn', 'Volt Switch', 'Shadow Pivot', 'Propulsion Shot'))
  ) {
    bpMods.push(6144);
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

  // Sheer Force does not power up max moves or remove the effects (SadisticMystic)
  if (
    (attacker.hasAbility('Sheer Force') &&
      (move.secondaries || move.named('Jet Punch', 'Order Up')) && !move.isMax) ||
    (attacker.hasAbility('Analytic') &&
      (turnOrder !== 'first' || field.defenderSide.isSwitching === 'out')) ||
    (attacker.hasAbility('Tough Claws') && move.flags.contact) ||
    (attacker.hasAbility('Punk Rock') && move.flags.sound) ||
    (attacker.hasAbility('Toxic Boost') &&
      attacker.hasStatus('psn', 'tox') && move.category === 'Physical')
  ) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Sand Force') && field.hasWeather('Sand') && move.hasType('Rock', 'Ground', 'Steel')) ||
    (attacker.hasAbility('Squall') && move.hasType('Flying', 'Water', 'Electric') && field.hasWeather('Rain', 'Heavy Rain'))
  ) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
    desc.weather = field.weather;
  }

  if (field.attackerSide.isBattery && move.category === 'Special') {
    bpMods.push(5325);
    desc.isBattery = true;
  }

  if (field.attackerSide.isTeamSpirit && move.category === 'Physical') {
    bpMods.push(5325);
    desc.isTeamSpirit = true;
  }

  if (field.attackerSide.isPowerSpot) {
    bpMods.push(5325);
    desc.isPowerSpot = true;
  }

  if (attacker.hasAbility('Rivalry') && ((defender.hasType(attacker.types[0]) || (attacker.types[1] && defender.hasType(attacker.types[1]))))) {
    if (attacker.gender === defender.gender) {
      bpMods.push(4915);
      // desc.rivalry can prob go unused
      // desc.rivalry = 'buffed';
    }
    desc.attackerAbility = attacker.ability;
  }

  // The -ate abilities already changed move typing earlier, so most checks are done and desc is set
  // However, Max Moves also don't boost -ate Abilities
  if (!move.isMax && hasAteAbilityTypeChange) {
    if (attacker.hasAbility('Normalize')) {
      bpMods.push(5325);
    } else {
      bpMods.push(4915);
    }
  }

  if ((attacker.hasAbility('Reckless') && (move.recoil || move.hasCrashDamage)) ||
    (attacker.hasAbility('Iron Fist') && move.flags.punch) ||
    (attacker.hasAbility('Cunning Blade') && move.flags.blade)
  ) {
    bpMods.push(4915);
    desc.attackerAbility = attacker.ability;
  }

  if (attacker.hasItem('Punching Glove') && move.flags.punch) {
    bpMods.push(4506);
    desc.attackerItem = attacker.item;
  } else if ((attacker.hasItem('Electirizer') && attacker.named('Electivire') && move.hasType('Electric')) ||
    (attacker.hasItem('Magmarizer') && attacker.named('Magmortar') && move.hasType('Fire'))) {
    bpMods.push(6144);
    desc.attackerItem = attacker.item;
  }

  if ((gen.num <= 8 && defender.hasAbility('Heatproof') && move.hasType('Fire')) ||
    (defender.hasAbility('Pure Heart', 'Shadow Armor') && move.hasType('Shadow'))) {
    bpMods.push(2048);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Dry Skin') && move.hasType('Fire')) {
    bpMods.push(5120);
    desc.defenderAbility = defender.ability;
  }

  if (attacker.hasAbility('Supreme Overlord') && attacker.alliesFainted) {
    const powMod = [4096, 4506, 4915, 5325, 5734, 6144];
    bpMods.push(powMod[Math.min(5, attacker.alliesFainted)]);
    desc.attackerAbility = attacker.ability;
    desc.alliesFainted = attacker.alliesFainted;
  }

  if (attacker.hasAbility('High Caliber') && move.flags.bullet) {
    bpMods.push(5325);
    desc.defenderAbility = defender.ability;
  }

  // Items

  if (attacker.hasItem(`${move.type} Gem`)) {
    bpMods.push(5325);
    desc.attackerItem = attacker.item;
  } else if (
    (((attacker.hasItem('Adamant Crystal') && attacker.named('Dialga-Origin')) ||
      (attacker.hasItem('Adamant Orb') && attacker.named('Dialga'))) &&
      move.hasType('Steel', 'Dragon')) ||
    (((attacker.hasItem('Lustrous Orb') &&
      attacker.named('Palkia')) ||
      (attacker.hasItem('Lustrous Globe') && attacker.named('Palkia-Origin'))) &&
      move.hasType('Water', 'Dragon')) ||
    (((attacker.hasItem('Griseous Orb') || attacker.hasItem('Griseous Core')) &&
      (attacker.named('Giratina-Origin') || attacker.named('Giratina'))) &&
      move.hasType('Ghost', 'Dragon')) ||
    (attacker.hasItem('Vile Vial') &&
      attacker.named('Venomicon-Epilogue') &&
      move.hasType('Poison', 'Flying')) ||
    (attacker.hasItem('Soul Dew') &&
      attacker.named('Latios', 'Latias', 'Latios-Mega', 'Latias-Mega') &&
      move.hasType('Psychic', 'Dragon')) ||
    attacker.item && move.hasType(getItemBoostType(attacker.item)) ||
    (attacker.name.includes('Ogerpon-Cornerstone') && attacker.hasItem('Cornerstone Mask')) ||
    (attacker.name.includes('Ogerpon-Hearthflame') && attacker.hasItem('Hearthflame Mask')) ||
    (attacker.name.includes('Ogerpon-Wellspring') && attacker.hasItem('Wellspring Mask')) ||
    (attacker.named('Darmanitan', 'Darmanizen', 'Darmanitan-Zen') && attacker.hasItem('Calm Candy Bar') && move.category === 'Special')
  ) {
    bpMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Muscle Band') && move.category === 'Physical') ||
    (attacker.hasItem('Wise Glasses') && move.category === 'Special')
  ) {
    bpMods.push(4505);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Truth Splicer') &&
      attacker.named('Omniverum') &&
      move.hasType('Fire', 'Dragon'))
  ) {
    bpMods.push(5324);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Ideals Splicer') &&
      attacker.named('Omniverum') &&
      move.hasType('Electric', 'Dragon'))
  ) {
    bpMods.push(5324);
    desc.attackerItem = attacker.item;
  }
  return bpMods;
}

export function calculateAttackSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {
  let attack: number;
  const attackSource = move.named('Foul Play', 'Shadow Duplicity') ? defender : attacker;
  if (move.named('Photon Geyser', 'Light That Burns the Sky') ||
    (move.named('Tera Blast') && attackSource.teraType)) {
    move.category = attackSource.stats.atk > attackSource.stats.spa ? 'Physical' : 'Special';
  }
  const attackStat =
    move.named('Shell Side Arm') &&
      getShellSideArmCategory(attacker, defender) === 'Physical'
      ? 'atk'
      : move.named('Body Press', 'Shadow Press')
        ? 'def'
        : move.category === 'Special'
          ? 'spa'
          : 'atk';
  desc.attackEVs =
    move.named('Foul Play', 'Shadow Duplicity')
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
  const atMods = calculateAtModsSMSSSV(gen, attacker, defender, move, field, desc);
  attack = OF16(Math.max(1, pokeRound((attack * chainMods(atMods, 410, 131072)) / 4096)));
  return attack;
}

export function calculateAtModsSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc
) {
  const atMods = [];

  // Slow Start also halves damage with special Z-moves
  if ((attacker.hasAbility('Slow Start') && attacker.abilityOn &&
    (move.category === 'Physical' || (move.category === 'Special' && move.isZ))) ||
    (attacker.hasAbility('Defeatist') && attacker.curHP() <= attacker.maxHP() / 2)
  ) {
    atMods.push(2048);
    desc.attackerAbility = attacker.ability;
  } else if ((field.hasWeather('Sun', 'Harsh Sunshine') && ((attacker.hasAbility('Solar Power') && move.category === 'Special') ||
    (attacker.hasAbility('Solar Boost') && move.category === 'Physical') ||
    ((attacker.named('Cherrim') && attacker.hasAbility('Flower Gift')) && move.category === 'Physical'))) ||
    (field.hasWeather('Hail', 'Snow') && attacker.hasAbility('Ice Breaker') && move.category === 'Physical')) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.weather = field.weather;
  } else if (attacker.hasAbility('Galaxian') && field.isGravity && move.category === 'Special') {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (
    // Gorilla Tactics has no effect during Dynamax (Anubis)
    (attacker.hasAbility('Gorilla Tactics') && move.category === 'Physical' &&
      !attacker.isDynamaxed)) {
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
    (attacker.hasAbility('Guts') && attacker.status && move.category === 'Physical') ||
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
  } else if (
    (attacker.hasAbility('Steelworker') && move.hasType('Steel')) ||
    (attacker.hasAbility('Dragon\'s Maw') && move.hasType('Dragon')) ||
    (attacker.hasAbility('Rocky Payload') && move.hasType('Rock')) ||
    (attacker.hasAbility('Corona') && move.hasType('Fire')) ||
    (attacker.hasAbility('Royal Guard') && attacker.curHP() <= attacker.maxHP() / 2)
  ) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Shadow Birch') && move.category === 'Physical' && field.hasTerrain('Grassy')) ||
    (attacker.hasAbility('Shadow Ribbons') && move.category === 'Special' && field.hasTerrain('Misty')) ||
    (attacker.hasAbility('Shadow Sparks') && move.category === 'Special' && field.hasTerrain('Electric'))) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.terrain = field.terrain;
  } else if (attacker.hasAbility('Transistor') && move.hasType('Electric')) {
    atMods.push(gen.num >= 9 ? 5325 : 6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Stakeout') && attacker.abilityOn) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Surging Mindforce') && move.category === 'Special' && field.hasTerrain('Psychic')) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.terrain = field.terrain;
  } else if (attacker.hasAbility('Grass Pelt') && move.category === 'Physical' && field.hasTerrain('Grassy')) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.terrain = field.terrain;
  } else if (attacker.hasAbility('Surging Rage') && field.hasTerrain('Berserk')) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.terrain = field.terrain;
  } else if (
    (attacker.hasAbility('Water Bubble') && move.hasType('Water')) ||
    (attacker.hasAbility('Huge Power', 'Pure Power') && move.category === 'Physical') ||
    (attacker.hasAbility('Mystic Power') && move.category === 'Special')
  ) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  } else if ((attacker.hasAbility('Seismography') && move.hasType('Ground')) ||
    (attacker.hasAbility('Stench') && move.hasType('Poison')) ||
    (attacker.hasAbility('Cursed Energy') && move.hasType('Ghost'))) {
    atMods.push(5325);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Shadow Adaptation') && move.hasType('Shadow')) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  }

  if ((defender.hasAbility('Thick Fat') && move.hasType('Fire', 'Ice')) ||
    (defender.hasAbility('Primal Warmth') && move.hasType('Fire', 'Water')) ||
    (defender.hasAbility('Water Bubble') && move.hasType('Fire')) ||
    (defender.hasAbility('Mythocide') && move.hasType('Fairy')) ||
    (defender.hasAbility('Purifying Salt') && move.hasType('Ghost'))) {
    atMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (gen.num >= 9 && defender.hasAbility('Heatproof') && move.hasType('Fire')) {
    atMods.push(2048);
    desc.defenderAbility = defender.ability;
  }
  // Pokemon with "-of Ruin" Ability are immune to the opposing "-of Ruin" ability
  const isTabletsOfRuinActive = (defender.hasAbility('Tablets of Ruin') || field.isTabletsOfRuin) &&
    !attacker.hasAbility('Tablets of Ruin');
  const isVesselOfRuinActive = (defender.hasAbility('Vessel of Ruin') || field.isVesselOfRuin) &&
    !attacker.hasAbility('Vessel of Ruin');
  if (
    (isTabletsOfRuinActive && move.category === 'Physical') ||
    (isVesselOfRuinActive && move.category === 'Special')
  ) {
    if (defender.hasAbility('Tablets of Ruin') || defender.hasAbility('Vessel of Ruin')) {
      desc.defenderAbility = defender.ability;
    } else {
      desc[move.category === 'Special' ? 'isVesselOfRuin' : 'isTabletsOfRuin'] = true;
    }
    atMods.push(3072);
  }

  if (isQPActive(attacker, field)) {
    if (
      (move.category === 'Physical' && getQPBoostedStat(attacker) === 'atk') ||
      (move.category === 'Special' && getQPBoostedStat(attacker) === 'spa')
    ) {
      atMods.push(5325);
      desc.attackerAbility = attacker.ability;
    }
  }

  if (
    (attacker.hasAbility('Hadron Engine') && move.category === 'Special' &&
      field.hasTerrain('Electric') && isGrounded(attacker, field)) ||
    (attacker.hasAbility('Orichalcum Pulse') && move.category === 'Physical' &&
      field.hasWeather('Sun', 'Harsh Sunshine') && !attacker.hasItem('Utility Umbrella'))
  ) {
    atMods.push(5461);
    desc.attackerAbility = attacker.ability;
  }

  if ((attacker.hasItem('Thick Club') &&
    attacker.named('Cubone', 'Marowak', 'Marowak-Alola', 'Marowak-Alola-Totem') &&
    move.category === 'Physical') ||
    (attacker.hasItem('Deep Sea Tooth') &&
      attacker.named('Clamperl') &&
      move.category === 'Special') ||
    (attacker.hasItem('Light Ball') && attacker.name.includes('Pikachu') && !move.isZ) ||
    (attacker.hasItem('Oval Stone') && attacker.name.includes('Happiny') && !move.isZ) ||
    (attacker.hasItem('Precious Scale') && attacker.named('Feebas-Vanessa') && !move.isZ) ||
    (move.category == 'Physical' && attacker.hasItem('Lucky Punch') && attacker.named('Chansey')) ||
    (attacker.hasItem('Amulet Coin') && attacker.name.includes('Meowth') && !move.isZ)
  ) {
    atMods.push(8192);
    desc.attackerItem = attacker.item;
    // Choice Band/Scarf/Specs move lock and stat boosts are ignored during Dynamax (Anubis)
  } else if (!move.isZ && !move.isMax &&
    (((attacker.hasItem('Choice Band') && move.category === 'Physical') ||
      (attacker.hasItem('Choice Specs') && move.category === 'Special')) ||
      (move.category === 'Physical' && attacker.hasItem('Bone Baton') && attacker.named('Osteoskhan')) ||
      (attacker.hasItem('Eviomight') && (gen.species.get(toID(attacker.name))?.nfe)))
  ) {
    atMods.push(6144);
    desc.attackerItem = attacker.item;
  }
  return atMods;
}

export function calculateDefenseSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {
  let defense: number;
  if (move.named('Combardment') && (defender.stats.def > defender.stats.spd)) {
    move.overrideDefensiveStat = 'spd';
  }
  const hitsPhysical = move.overrideDefensiveStat !== 'spd' &&
    (move.overrideDefensiveStat === 'def' || move.category === 'Physical' ||
      (move.named('Shell Side Arm') && getShellSideArmCategory(attacker, defender) === 'Physical'));
  const defenseStat = hitsPhysical ? 'def' : 'spd';
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
  if (field.hasWeather('Hail', 'Snow') && defender.hasType('Ice') && hitsPhysical) {
    defense = pokeRound((defense * 3) / 2);
    desc.weather = field.weather;
  }

  const dfMods = calculateDfModsSMSSSV(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    isCritical,
    hitsPhysical
  );

  return OF16(Math.max(1, pokeRound((defense * chainMods(dfMods, 410, 131072)) / 4096)));
}

export function calculateDfModsSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
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
  } else if (
    defender.hasAbility('Grass Pelt') &&
    field.hasTerrain('Grassy') &&
    hitsPhysical
  ) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
  } else if (
    defender.hasAbility('Misty Cover') &&
    field.hasTerrain('Misty')
  ) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
   } else if (
    defender.hasAbility('Surging Mindforce') &&
    field.hasTerrain('Psychic') &&
    !hitsPhysical
  ) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Fur Coat') && hitsPhysical) {
    dfMods.push(8192);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Stall')) {
    dfMods.push(5325);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Luminesce') && defender.abilityOn && !hitsPhysical) {
    dfMods.push(6144);
    desc.defenderAbility = 'Luminesce';
  }
  // Pokemon with "-of Ruin" Ability are immune to the opposing "-of Ruin" ability
  const isSwordOfRuinActive = (attacker.hasAbility('Sword of Ruin') || field.isSwordOfRuin) &&
    !defender.hasAbility('Sword of Ruin');
  const isBeadsOfRuinActive = (attacker.hasAbility('Beads of Ruin') || field.isBeadsOfRuin) &&
    !defender.hasAbility('Beads of Ruin');
  if (
    (isSwordOfRuinActive && hitsPhysical) ||
    (isBeadsOfRuinActive && !hitsPhysical)
  ) {
    if (attacker.hasAbility('Sword of Ruin') || attacker.hasAbility('Beads of Ruin')) {
      desc.attackerAbility = attacker.ability;
    } else {
      desc[hitsPhysical ? 'isSwordOfRuin' : 'isBeadsOfRuin'] = true;
    }
    dfMods.push(3072);
  }

  if (isQPActive(defender, field)) {
    if (
      (hitsPhysical && getQPBoostedStat(defender) === 'def') ||
      (!hitsPhysical && getQPBoostedStat(defender) === 'spd')
    ) {
      desc.defenderAbility = defender.ability;
      dfMods.push(5324);
    }
  }

  if ((defender.hasItem('Eviolite') &&
    (gen.species.get(toID(defender.name))?.nfe)) ||
    (!hitsPhysical && defender.hasItem('Assault Vest'))) {
    dfMods.push(6144);
    desc.defenderItem = defender.item;
  } else if (
    (defender.hasItem('Metal Powder') && defender.named('Ditto') && hitsPhysical) ||
    (defender.hasItem('Deep Sea Scale') && defender.named('Clamperl') && !hitsPhysical)
  ) {
    dfMods.push(8192);
    desc.defenderItem = defender.item;
  }
  return dfMods;
}

function calculateBaseDamageSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
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
    baseDamage = pokeRound(OF32(baseDamage * 1024) / 4096);
  }

  if (
    field.hasWeather('Sun') && move.named('Hydro Steam') && !attacker.hasItem('Utility Umbrella')
  ) {
    baseDamage = pokeRound(OF32(baseDamage * 6144) / 4096);
    desc.weather = field.weather;
  } else if (!defender.hasItem('Utility Umbrella')) {
    if (
      (field.hasWeather('Sun', 'Harsh Sunshine') && move.hasType('Fire')) ||
      (field.hasWeather('Rain', 'Heavy Rain') && move.hasType('Water')) ||
      (field.hasWeather('Miasma') && move.hasType('Poison')) ||
      (field.hasWeather('Shadow Sky') && move.hasType('Shadow'))
    ) {
      baseDamage = pokeRound(OF32(baseDamage * 6144) / 4096);
      desc.weather = field.weather;
    } else if (
      (field.hasWeather('Sun') && move.hasType('Water')) ||
      (field.hasWeather('Rain') && move.hasType('Fire'))
    ) {
      baseDamage = pokeRound(OF32(baseDamage * 2048) / 4096);
      desc.weather = field.weather;
    }
  }

  if (isCritical) {
    baseDamage = Math.floor(OF32(baseDamage * 1.5));
    desc.isCritical = isCritical;
  }

  return baseDamage;
}

export function calculateFinalModsSMSSSV(
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

  if (field.defenderSide.isReflect && move.category === 'Physical' &&
    !isCritical && !field.defenderSide.isAuroraVeil) {
    // doesn't stack with Aurora Veil
    finalMods.push(field.gameType !== 'Singles' ? 2732 : 2048);
    desc.isReflect = true;
  } else if (
    field.defenderSide.isLightScreen && move.category === 'Special' &&
    !isCritical && !field.defenderSide.isAuroraVeil
  ) {
    // doesn't stack with Aurora Veil
    finalMods.push(field.gameType !== 'Singles' ? 2732 : 2048);
    desc.isLightScreen = true;
  }
  if (field.defenderSide.isAuroraVeil && !isCritical) {
    finalMods.push(field.gameType !== 'Singles' ? 2732 : 2048);
    desc.isAuroraVeil = true;
  }

  if (attacker.hasAbility('Neuroforce') && typeEffectiveness > 1) {
    finalMods.push(5120);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Sniper') && isCritical) {
    finalMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Tinted Lens') && typeEffectiveness < 1) {
    finalMods.push(8192);
    desc.attackerAbility = attacker.ability;
  }

  if (defender.isDynamaxed && move.named('Dynamax Cannon', 'Behemoth Blade', 'Behemoth Bash')) {
    finalMods.push(8192);
  }

  if (defender.hasAbility('Multiscale', 'Shadow Shield') &&
    defender.curHP() === defender.maxHP() &&
    hitCount === 0 &&
    (!field.defenderSide.isSR && !field.defenderSide.steelsurge && (!field.defenderSide.spikes || !isGrounded(defender, field)) ||
      defender.hasItem('Heavy-Duty Boots')) && !attacker.hasAbility('Parental Bond (Child)')
  ) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (defender.hasAbility('Fluffy') && move.flags.contact && !attacker.hasAbility('Long Reach')) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  } else if (
    (defender.hasAbility('Punk Rock') && move.flags.sound) ||
    (defender.hasAbility('Ice Scales') && move.category === 'Special')
  ) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (defender.hasAbility('Solid Rock', 'Filter', 'Prism Armor') && typeEffectiveness > 1) {
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
  if (defender.hasAbility('Royal Guard') && defender.curHP() <= defender.maxHP() / 2) {
    finalMods.push(3072);
    desc.defenderAbility = defender.ability;
  }
  if (field.defenderSide.isFriendGuard) {
    finalMods.push(3072);
    desc.isFriendGuard = true;
  }

  if (defender.hasAbility('Fluffy') && move.hasType('Fire')) {
    finalMods.push(8192);
    desc.defenderAbility = defender.ability;
  }

  if (attacker.hasItem('Expert Belt') && typeEffectiveness > 1 && !move.isZ) {
    finalMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem('Life Orb')) {
    finalMods.push(5324);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem('Metronome') && move.timesUsedWithMetronome! >= 1) {
    const timesUsedWithMetronome = Math.floor(move.timesUsedWithMetronome!);
    if (timesUsedWithMetronome <= 4) {
      finalMods.push(4096 + timesUsedWithMetronome * 819);
    } else {
      finalMods.push(8192);
    }
    desc.attackerItem = attacker.item;
  }

  if (move.hasType(getBerryResistType(defender.item)) &&
    (typeEffectiveness > 1 || move.hasType('Normal')) &&
    hitCount === 0 &&
    !attacker.hasAbility('Unnerve', 'As One (Glastrier)', 'As One (Spectrier)')) {
    if (defender.hasAbility('Ripen')) {
      finalMods.push(1024);
    } else {
      finalMods.push(2048);
    }
    desc.defenderItem = defender.item;
  }

  return finalMods;
}

function hasTerrainSeed(pokemon: Pokemon) {
  return pokemon.hasItem('Electric Seed', 'Misty Seed', 'Grassy Seed', 'Psychic Seed', 'Berserk Seed');
}

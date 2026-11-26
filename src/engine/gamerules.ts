export type GameRuleValue = boolean | number;

const BOOL_DEFAULTS: Record<string, boolean> = {
  commandblockoutput: true, dodaylightcycle: true, doentitydrops: true, dofiretick: true, recipesunlock: true,
  dolimitedcrafting: false, domobloot: true, domobspawning: true, dotiledrops: true, doweathercycle: true,
  drowningdamage: true, falldamage: true, firedamage: true, keepinventory: false, mobgriefing: true, pvp: true,
  showcoordinates: false, showdaysplayed: false, naturalregeneration: true, tntexplodes: true,
  sendcommandfeedback: true, doinsomnia: true, commandblocksenabled: true, doimmediaterespawn: false,
  showdeathmessages: true, showtags: true, freezedamage: true, respawnblocksexplode: true, showbordereffect: true,
  showrecipemessages: true, projectilescanbreakblocks: true, tntexplosiondropdecay: false,
};

const INT_DEFAULTS: Record<string, number> = {
  maxcommandchainlength: 65535, randomtickspeed: 1, functioncommandlimit: 10000, spawnradius: 10, playerssleepingpercentage: 100,
};

export const GAMERULE_DEFAULTS: Record<string, GameRuleValue> = { ...BOOL_DEFAULTS, ...INT_DEFAULTS };
export const isIntRule = (name: string) => name in INT_DEFAULTS;

/** Rules whose value changes how the simulator behaves; every other rule is stored and reported only. */
export const ENFORCED_RULES = ['commandblocksenabled', 'maxcommandchainlength', 'sendcommandfeedback'];

import type { Lang } from './i18n.ts';

/** Chinese names of common items for the "gave" messages; other items keep their English name. */
const ITEMS_ZH: Record<string, string> = {
  air: '空气', diamond: '钻石', iron_ingot: '铁锭', gold_ingot: '金锭', emerald: '绿宝石', stone: '石头', dirt: '泥土', cobblestone: '圆石',
  oak_planks: '橡木木板', apple: '苹果', golden_apple: '金苹果', bread: '面包', stick: '木棍', diamond_sword: '钻石剑', diamond_pickaxe: '钻石镐',
  iron_sword: '铁剑', bow: '弓', arrow: '箭', ender_pearl: '末影珍珠', command_block: '命令方块', redstone: '红石粉', torch: '火把', coal: '煤炭',
  chest: '箱子', crafting_table: '工作台', snowball: '雪球', egg: '鸡蛋', water_bucket: '水桶', lava_bucket: '熔岩桶', tnt: 'TNT', glass: '玻璃',
  sand: '沙子', gravel: '沙砾', obsidian: '黑曜石', netherite_ingot: '下界合金锭', elytra: '鞘翅', shield: '盾牌', totem_of_undying: '不死图腾',
};
const itemZh = (shown: string) => ITEMS_ZH[shown.toLowerCase().replace(/ /g, '_')] ?? shown;

/**
 * Translates the output the game prints (command feedback and errors) when the interface is Chinese, like the game does.
 * The texts of the messages the game's own players confirmed are exact; the rest are marked in docs/游戏内验证清单.md.
 * A message that has no entry stays as it is; add entries here.
 */
const RULES: [RegExp, (...m: string[]) => string][] = [
  [/^Applied damage to (\d+) entities$/, (_, n) => `已将伤害施加于${n}个实体`],
  [/^Applied damage to (.+)$/, (_, who) => `已将伤害施加于${who}`],
  [/^Unable to apply damage to (.+)$/, (_, who) => `无法将伤害施加于${who}`],
  [/^Toggled downfall$/, () => '天气已切换'],
  [/^Function (.+) not found\.$/, (_, name) => `未找到${name}函数。`],
  [/^Target data:([\s\S]*)$/, (_, rest) => `目标数据:${rest}`],
  [/^Game rule (\w+) has been updated to (.+)$/, (_, rule, value) => `游戏规则${rule}已更新为${value}`],
  [/^Gave (\d+) (.+) to (.+)$/, (_, n, item, who) => `已将${n}个${itemZh(item)}给予${who}`],
  [/^You were given (\d+) (.+)$/, (_, n, item) => `你被给予${n}个${itemZh(item)}`],
  [/^Unknown command: \/?(.+)$/, (_, name) => `未知的命令:${name}。请检查命令是否存在,以及您是否有权限使用它。`],
];

export function gameText(text: string, lang: Lang): string {
  if (lang !== 'zh') return text;
  const wrapped = /^(\u00a77\u00a7o\[[^:\]]*: )([\s\S]*)(\]\u00a7r)$/.exec(text);
  if (wrapped) return wrapped[1] + gameText(wrapped[2], lang) + wrapped[3];
  for (const [re, f] of RULES) {
    const m = re.exec(text);
    if (m) return f(...m);
  }
  return text;
}
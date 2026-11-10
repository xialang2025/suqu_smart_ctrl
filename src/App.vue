<script>
//20261110-0 add - Keep global styling independent of communication state.
export default {};
</script>
<style>
page { background: #f3f6fa; color: #192638; font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
body { margin: 0; }
* { box-sizing: border-box; }
button::after { border: none; }
button { font: inherit; }
.screen { min-height: 100vh; padding: 24px 18px; }
.brand { font-size: 28px; font-weight: 700; letter-spacing: 2px; color: #155fa9; }
.subtitle { color: #617185; font-size: 14px; margin-top: 8px; }
.section { margin-top: 24px; padding: 18px; border: 1px solid #dce5ef; border-radius: 12px; background: #fff; }
.section-title { font-size: 18px; font-weight: 600; }
.notice { margin-top: 12px; color: #586c82; font-size: 14px; line-height: 1.6; }
.empty { text-align: center; padding: 48px 16px; color: #718298; line-height: 1.8; }
/*20261110-1 add - Keep scan actions and device identities readable. */
.actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.primary, .secondary { margin: 0; padding: 0 18px; min-height: 44px; line-height: 44px; font-size: 15px; border-radius: 8px; }
.primary { background: #1668b5; color: white; }
.secondary { background: #edf3f9; color: #155fa9; }
.device-card { margin-top: 14px; padding: 18px; background: #fff; border: 1px solid #dce5ef; border-radius: 12px; }
.device-name { font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
.device-address { margin-top: 6px; font-family: Consolas, monospace; font-size: 13px; color: #617185; }
.device-meta { display: flex; justify-content: space-between; color: #617185; font-size: 13px; margin-top: 12px; }
</style>

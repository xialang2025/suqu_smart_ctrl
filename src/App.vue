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
/*20261110-2 add - Separate a ready device from its raw receive window. */
.ready { color: #127b57; font-weight: 600; }
.connect { margin-top: 14px; }
.control-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.control-device { margin-top: 20px; }
.data-panel { padding: 14px; }
.data-scroll { display: block; height: 54vh; margin-top: 10px; }
.data-record { padding: 10px 0; border-bottom: 1px solid #e6edf5; }
.record-meta { color: #75859a; font-size: 12px; }
.record-bytes { font-family: Consolas, monospace; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.6; margin-top: 5px; font-size: 15px; }
/*20261110-3 add - Keep both data windows and manual input within the control screen. */
.control-screen { height: 100vh; height: 100dvh; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; overflow: hidden; }
.control-screen .control-device { margin-top: 0; }
.control-screen .notice { margin-top: 0; flex: none; }
.control-screen .data-panel { display: flex; flex-direction: column; flex: 1 1 0; min-height: 120px; margin-top: 0; }
.control-screen .data-scroll { height: 0; flex: 1; min-height: 0; }
.control-screen .send-panel { min-height: 210px; }
.send-input-row { display: flex; gap: 8px; align-items: stretch; flex: none; margin-top: 10px; }
.hex-input { display: block; flex: 1; width: 0; height: 64px; min-height: 64px; border: 1px solid #c6d5e5; border-radius: 8px; padding: 8px; font: 14px/1.5 Consolas, monospace; }
.send-button { align-self: stretch; display: flex; align-items: center; justify-content: center; min-width: 68px; padding: 0 10px; }
.input-note { margin-top: 6px; color: #75859a; font-size: 11px; }
.compact { padding: 12px; }
.success { color: #127b57; }
.failed { color: #b12929; }
.unknown { color: #98630c; }
</style>

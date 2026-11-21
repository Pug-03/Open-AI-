export function createVoiceTools({ resolveIntent, askTrip, openSosSheet }) {
  return {
    async plan_trip(args) {
      if (!args || typeof args.utterance !== "string" || !args.utterance.trim() || args.utterance.length > 500) {
        return { status: "invalid" };
      }
      const intent = await resolveIntent({ text: args.utterance });
      return { ...intent, speak_text: "ตรวจชื่อจุดเริ่มต้นและปลายทางบนฟอร์มได้" };
    },
    async ask_trip(args) {
      if (!args || typeof args.question !== "string" || args.question.length > 500) return { status: "invalid" };
      // Bind the current trip in the client. Provider-supplied IDs never choose a different session.
      return askTrip(args.question);
    },
    async open_sos_sheet(args) {
      if (!args || Object.keys(args).length !== 1 || !["user_asked", "emergency_words"].includes(args.reason)) {
        return { status: "invalid" };
      }
      await openSosSheet();
      return { status: "opened", speak_text: "เปิดหน้าช่วยเหลือแล้ว" };
    },
  };
}

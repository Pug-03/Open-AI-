// Keep both translations aligned with actual data flows and optional services.

export interface PolicySection {
  title: string;
  body?: string;
  items?: string[];
}
export interface Policy {
  title: string;
  updated: string;
  intro: string;
  sections: PolicySection[];
}

export const PRIVACY_POLICY: Record<'th' | 'en', Policy> = {
  th: {
    title: 'นโยบาย\u200bความเป็นส่วนตัว',
    updated: 'มีผลตั้งแต่ 21 พฤศจิกายน 2569',
    intro:
      'ใช้แผนที่และวางเส้นทางได้โดยไม่ต้องสมัครสมาชิก หน้านี้อธิบายข้อมูลที่ Walk We เก็บในเครื่อง และข้อมูลที่ใช้เมื่อคุณเลือกใช้ฟีเจอร์ออนไลน์',
    sections: [
      {
        title: 'ข้อมูลที่เก็บไว้ในเครื่องของคุณเท่านั้น',
        body: 'ข้อมูลเหล่านี้อยู่ในเบราว์เซอร์บนมือถือของคุณ เราไม่ได้รับ ไม่ได้เห็น และไม่ได้เก็บไว้ที่เซิร์ฟเวอร์ใด',
        items: [
          'เบอร์โทรของคุณ (ถ้าคุณกรอก) ใช้ใส่ในข้อความ SOS ให้ผู้ติดต่อโทรกลับได้',
          'ผู้ติดต่อฉุกเฉิน ชื่อและเบอร์ไม่เกิน 5 คน ใช้ตอนกด SOS',
          'สถานที่ที่บันทึก (บ้าน ที่ทำงาน) และสถานที่ที่ค้นหาล่าสุด',
          'การเดินทางที่กำลังนำทางอยู่ เพื่อให้เปิดแอปกลับมาเดินต่อได้ ไม่เก็บประวัติการเดินย้อนหลัง',
          'การตั้งค่า เช่น ภาษา ธีม ปัจจัยที่เลือกตอนกลางคืน และว่าคุณดูหน้าแนะนำไปแล้วหรือยัง',
          'ไฟล์แอป รูปนำทาง และแผนที่ ที่เก็บไว้ให้ใช้ต่อได้ตอนไม่มีเน็ต',
        ],
      },
      {
        title: 'ตำแหน่งของคุณ',
        items: [
          'แอปขอตำแหน่ง GPS เมื่อคุณกด "ใช้ตำแหน่งปัจจุบัน" หรือระหว่างนำทาง และเฉพาะเมื่อคุณอนุญาตเท่านั้น',
          'แอปใช้ตำแหน่งที่แม่นยำคำนวณเส้นทางบนอุปกรณ์ การตรวจหลักฐานออนไลน์ใช้รหัสสถานที่สาธารณะ เวลาออกเดิน และข้อจำกัดที่คุณเลือก',
          'เมื่อคุณเลือกส่ง SOS หรือแชร์ตำแหน่ง แอปส่งตำแหน่งไปยังผู้รับที่คุณเลือกผ่าน SMS, LINE หรือบริการส่ง SOS ที่เปิดไว้',
        ],
      },
      {
        title: 'ข้อมูลที่ส่งไปยังบริการภายนอก',
        body: 'บริการออนไลน์อาจเห็น IP address ของคุณตามปกติของการใช้เว็บ ข้อมูลที่ส่งขึ้นอยู่กับฟีเจอร์ที่คุณเลือก',
        items: [
          'Photon (komoot) สำหรับค้นหาสถานที่: ได้รับคำที่คุณพิมพ์ค้นหา และจุดเริ่มต้นแบบคร่าว ๆ (ปัดเป็นประมาณ 1 กม.)',
          'Open-Meteo สำหรับข้อมูลเมฆ: ได้รับจุดเริ่มต้นแบบคร่าว ๆ (ประมาณ 1 กม.) และเวลาที่คุณจะเดิน',
          'OpenFreeMap สำหรับแผนที่: ได้รับคำขอไฟล์แผนที่ของบริเวณที่คุณกำลังดู',
          'เมื่อคุณส่งคำขอเดินทางเป็นประโยค เซิร์ฟเวอร์ของ Walk We จะอ่านคำขอ และอาจส่งข้อความให้ OpenAI หากเปิดใช้โมเดลออนไลน์',
          'เมื่อเปิดไมค์ในโหมด GPT‑Live เสียงจะส่งไปยัง OpenAI ระหว่างการสนทนาเพื่อประมวลผล แอปไม่บันทึกไฟล์เสียงหรือบทสนทนา',
          'เมื่อใช้ฟีเจอร์อ่านออกเสียง แอปอาจส่งข้อความและภาษาผ่านเซิร์ฟเวอร์ของ Walk We ไปยัง OpenAI ตามการตั้งค่าของเว็บไซต์',
          'ถ้าเปิดใช้บริการส่ง SOS แบบลงชื่อเข้าใช้ เมื่อคุณยืนยันส่ง บริการจะได้รับตำแหน่งล่าสุดที่หาได้และข้อมูลปลายทางที่ยืนยันแล้ว Walk We เก็บรหัสผู้ส่ง ผู้รับ และสถานะการส่งชั่วคราวเพื่อป้องกันการส่งซ้ำและแสดงผลตอบรับ',
          'เซิร์ฟเวอร์ที่ให้บริการเว็บนี้อาจบันทึก IP และหน้าที่เปิดไว้ชั่วคราวตามปกติของเว็บทั่วไป',
        ],
      },
      {
        title: 'คุกกี้และการติดตาม',
        items: [
          'บริการส่ง SOS แบบลงชื่อเข้าใช้อาจใช้คุกกี้ของระบบยืนยันตัวตน',
          'ไม่ใช้คุกกี้ติดตาม ไม่มีโฆษณา ไม่มีเครื่องมือวิเคราะห์พฤติกรรม',
        ],
      },
      {
        title: 'สิทธิ์ของคุณและการลบข้อมูล',
        body: 'คุณแก้เบอร์และผู้ติดต่อที่บันทึกไว้ในเครื่องได้ในหน้าผู้ติดต่อฉุกเฉิน หรือล้างข้อมูลอุปกรณ์ด้วยปุ่มด้านล่างและการตั้งค่าเบราว์เซอร์ หากลงทะเบียนผู้รับ SOS ผ่านบริการแยก ให้จัดการข้อมูลการลงทะเบียนกับบริการนั้น',
      },
      {
        title: 'การเปลี่ยนแปลงนโยบาย',
        body: 'ถ้าแอปเริ่มเก็บหรือส่งข้อมูลต่างจากนี้ เราจะแก้หน้านี้และวันที่มีผลก่อนเปลี่ยน',
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    updated: 'Effective 21 November 2026',
    intro:
      'You can use maps and plan routes without signing up. This page explains what Walk We stores on your device and what data it uses when you choose an online feature.',
    sections: [
      {
        title: 'Kept on your phone only',
        body: 'This data lives in the browser on your phone. We don’t receive it, see it or store it on any server.',
        items: [
          'Your phone number (if you enter it), added to SOS messages so contacts can call you back',
          'Emergency contacts: up to 5 names and numbers, used when you press SOS',
          'Saved places (home, work) and recent searches',
          'The walk in progress, so you can reopen the app and carry on. No walk history is kept',
          'Settings such as language, theme, the night-time factors you picked, and whether you’ve seen the intro',
          'App files, step photos and map tiles saved for offline use',
        ],
      },
      {
        title: 'Your location',
        items: [
          'The app asks for GPS when you tap “Use current location” or during navigation, and only if you allow it',
          'The app uses your exact position to calculate routes on your device. Online evidence review uses public landmark identifiers, departure time and your route constraints',
          'When you choose to send SOS or share your location, the app sends it to the recipient you select through SMS, LINE or the configured SOS delivery service',
        ],
      },
      {
        title: 'Sent to outside services',
        body: 'Online services may see your IP address. The information sent depends on the feature you choose.',
        items: [
          'Photon (komoot), place search: the text you type and a rough start point (rounded to about 1 km)',
          'Open-Meteo, cloud cover: a rough start point (about 1 km) and the time you plan to walk',
          'OpenFreeMap, maps: requests for the map tiles of the area you are viewing',
          'When you submit a written trip request, the Walk We server reads it and may send the text to OpenAI when the online model is enabled',
          'When you turn on the microphone in GPT‑Live, your audio goes to OpenAI for the session. The app keeps no audio recording or conversation transcript',
          'For read-aloud, the app may send the text and language through the Walk We server to OpenAI, according to the website configuration',
          'If signed-in SOS delivery is enabled, confirming a send gives the service your latest available location and the verified destination. Walk We temporarily keeps sender and recipient identifiers and delivery state to prevent duplicate sends and report acknowledgement',
          'The server hosting this site may briefly log IP addresses and pages opened, as websites normally do',
        ],
      },
      {
        title: 'Cookies and tracking',
        items: [
          'Signed-in SOS delivery may use session cookies from the configured identity service',
          'No tracking cookies, no ads, no behaviour analytics',
        ],
      },
      {
        title: 'Your rights and deleting data',
        body: 'Edit the phone number and contacts stored on your device through the emergency contacts page. Use the button below or browser settings to clear local data. If you enrolled recipients with a separate SOS service, manage those records with that service.',
      },
      {
        title: 'Changes to this policy',
        body: 'If the app starts keeping or sending data differently, we will update this page and its effective date before the change.',
      },
    ],
  },
};

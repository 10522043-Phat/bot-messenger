require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const app = express();
app.use(express.json());

// ===== CẤU HÌNH =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mytoken123";
const USER_FILE         = "users.json";
const SPREADSHEET_URL   =
  "https://docs.google.com/spreadsheets/d/16qGYp9tNVfZFjy2EkuUCEQb1wAAlRYJx4JU4TxUACJQ/edit?pli=1&gid=0#gid=0";

// Danh sách tên hợp lệ – khớp với cột "Name" trong Google Sheet
const ALLOWED_NAMES = ["Nguyen Van A", "Tran Thi B"];
// ====================


// ===== QUẢN LÝ USER =====
function docDanhSachUser() {
  if (!fs.existsSync(USER_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(USER_FILE, "utf8")); }
  catch { return {}; }
}

function luuUser(senderId, ten = "Chưa xác nhận tên") {
  const users = docDanhSachUser();
  if (users[senderId]?.xacNhan) return;
  users[senderId] = {
    ten,
    xacNhan: false,
    thoiGianThamGia: new Date().toLocaleString("vi-VN"),
  };
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
  console.log(`💾 Đã lưu user mới: ${ten} (${senderId})`);
}

function xacNhanUser(senderId, ten) {
  const users = docDanhSachUser();
  users[senderId] = {
    ten,
    xacNhan: true,
    thoiGianThamGia: users[senderId]?.thoiGianThamGia || new Date().toLocaleString("vi-VN"),
  };
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
  console.log(`✅ Đã xác nhận tên: ${ten} (${senderId})`);
}


// ===== LỊCH NHẮC ĐÓNG TIỀN =====
// Chạy lúc 8:00 sáng ngày 1 mỗi tháng
cron.schedule("0 8 1 * *", async () => {
  console.log("⏰ Đến giờ gửi nhắc đóng tiền!");
  const users = docDanhSachUser();
  for (const [senderId, info] of Object.entries(users)) {
    const ten = info.xacNhan ? info.ten : "bạn";
    await guiTinNhan(
      senderId,
      `💰 Xin chào ${ten}!\n\n` +
      `⚠️ Nhắc nhở: Đã đến hạn đóng tiền tháng này!\n` +
      `📅 Vui lòng đóng trước ngày 05.\n\n` +
      `Cảm ơn bạn! 🙏`
    );
  }
}, { timezone: "Asia/Ho_Chi_Minh" });


// ===== WEBHOOK – XÁC THỰC =====
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  console.log("Token nhận được:", token);
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook xác thực thành công!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Xác thực thất bại");
    res.sendStatus(403);
  }
});


// ===== WEBHOOK – NHẬN SỰ KIỆN =====
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Trả về 200 NGAY để Facebook không gửi lại event
  res.status(200).send("EVENT_RECEIVED");

  if (body.object !== "page") return;

  for (const entry of body.entry) {
    if (!entry.messaging) continue;

    for (const event of entry.messaging) {
      const senderId = event.sender?.id;
      if (!senderId) continue;

      // ══════════════════════════════════════════════════════
      //  CÁCH 2 – REFERRAL (m.me link)
      //  Khi user nhấn link https://m.me/TranAgness?ref=welcome
      //  → bot tự động nhắn tin NGAY, không cần bấm Get Started
      // ══════════════════════════════════════════════════════
      if (event.referral && !event.postback) {
        console.log(`🔗 [referral] User vào từ link: ${senderId}`);
        const users = docDanhSachUser();
        if (!users[senderId]) luuUser(senderId);
        if (!users[senderId]?.xacNhan) {
          await xuLyGetStarted(senderId);
        } else {
          await guiTinNhan(senderId, `Chào lại ${users[senderId].ten}! 👋`);
        }
        continue;
      }

      // ── Nút Get Started (vẫn giữ để hỗ trợ) ──
      if (event.postback?.payload === "GET_STARTED") {
        console.log(`👋 [get_started] ${senderId}`);
        luuUser(senderId);
        await xuLyGetStarted(senderId);
        continue;
      }

      // ── Tin nhắn thường ──
      if (event.message?.text && !event.message.is_echo) {
        const userMessage = event.message.text.trim();
        console.log(`📩 [message] Từ ${senderId}: ${userMessage}`);
        const users = docDanhSachUser();
        if (!users[senderId]) {
          luuUser(senderId);
          await xuLyGetStarted(senderId);
        } else {
          await xuLyTinNhan(senderId, userMessage, users[senderId]);
        }
        continue;
      }
    }
  }
});


// ===== XỬ LÝ CHÀO USER MỚI =====
async function xuLyGetStarted(senderId) {
  await guiTinNhan(
    senderId,
    "Xin chào! Chào mừng bạn đến với page của chúng tôi! 👋\n\n" +
    "Bạn sẽ nhận được nhắc nhở đóng tiền hàng tháng tự động.\n\n" +
    "📝 Vui lòng nhập họ tên đầy đủ của bạn để xác nhận:\n" +
    "(Điền đúng tên ở cột 'Name' từ file Invoice2 đã cung cấp)\n\n" +
    SPREADSHEET_URL
  );
}


// ===== XỬ LÝ TIN NHẮN =====
async function xuLyTinNhan(senderId, userMessage, userInfo) {
  if (!userInfo.xacNhan) {
    const tenKhop = ALLOWED_NAMES.find(
      (ten) => ten.toLowerCase() === userMessage.toLowerCase()
    );
    if (tenKhop) {
      xacNhanUser(senderId, tenKhop);
      await guiTinNhan(senderId, `✅ Xác nhận thành công! Xin chào ${tenKhop}!`);
      await guiTinNhan(senderId, "📅 Bạn sẽ nhận nhắc nhở đóng tiền tự động hàng tháng. 🎉");
    } else {
      await guiTinNhan(
        senderId,
        `❌ Tên "${userMessage}" không có trong danh sách.\n` +
        "Vui lòng nhập lại đúng họ tên:"
      );
    }
  } else {
    if (userMessage.toLowerCase() === "xem danh sách") {
      const users = docDanhSachUser();
      const danhSach = Object.values(users)
        .filter((u) => u.xacNhan)
        .map((u, i) => `${i + 1}. ${u.ten}`)
        .join("\n");
      await guiTinNhan(
        senderId,
        `📋 Danh sách đã xác nhận:\n\n${danhSach}\n\n` +
        `Tổng: ${Object.values(users).filter((u) => u.xacNhan).length} người`
      );
    } else {
      await guiTinNhan(
        senderId,
        `Xin chào ${userInfo.ten}! 👋\nBạn cần hỗ trợ gì không?`
      );
    }
  }
}


// ===== GỬI TIN NHẮN =====
async function guiTinNhan(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: recipientId },
        message: { text },
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`📤 Đã gửi: "${text.substring(0, 60)}..."`);
  } catch (err) {
    console.error("❌ Lỗi gửi tin:", err.response?.data || err.message);
  }
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
  console.log("⏰ Đã bật lịch nhắc đóng tiền tự động!");
  console.log(`🔗 Link đăng vào nhóm: https://m.me/${process.env.PAGE_NAME}?ref=welcome`);
});

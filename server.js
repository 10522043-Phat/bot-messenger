require("dotenv").config();
const express  = require("express");
const axios    = require("axios");
const cron     = require("node-cron");
const mongoose = require("mongoose");
const app      = express();
app.use(express.json());

// ===== CẤU HÌNH =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mytoken123";
const MONGODB_URI       = process.env.MONGODB_URI;
const QR_CODE_URL       = "https://ibb.co/9m1Np9PY";
const DANH_SACH_TEN_URL ="https://ibb.co/s4PVx01";
let ALLOWED_NAMES = [
  "Quyên", "Trúc Ngân", "Thiên An", "Hao Huynh",
  "Trần Agness", "Bảo Duy", "Ryan Nguyen", "Gia Bảo",
  "Thái Nam", "Nguyễn Phúc", "Đức Thiện", "Trần Yến Nhi",
  "Duy Nguyen", "Vinhh", "Le Bao Khang", "Hùng Anh",
  "Anh Minh", "Đình Hiệu", "Sơn Minh", "Quách Minh Phúc",
  "Nguyen Axiom", "Nguyen Truc", "Hải Dương", "Simon Hua",
  "Khang Tran", "Đăng Khoa", "Xuân Khoa",
  "Nguyên Ngọc Khánh Uyên", "Nguyễn Trường Thịnh",
  "Son Le", "Hà Minh Khải", "Kenneth Reichert", "Trần Bình Minh",
"Công Thành", "Khai Le", "Hương Võ", "Vũ Kha"
];
// ====================


// ===== KẾT NỐI MONGODB =====
mongoose.connect(MONGODB_URI)
  .then(() => console.log("Kết nối MongoDB thành công"))
  .catch(err => console.error("Lỗi MongoDB:", err));

const userSchema = new mongoose.Schema({
  senderId:        { type: String, required: true, unique: true },
  ten:             { type: String, default: "Chưa xác nhận" },
  xacNhan:         { type: Boolean, default: false },
  choDoiThanhToan:    { type: Boolean, default: false },
  thoiGianThamGia: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);


// ===== LƯU USER MỚI =====
async function luuUserMoi(senderId) {
  try {
    const existing = await User.findOne({ senderId });
    if (!existing) {
      await User.create({ senderId });
      console.log(`Đã lưu user mới: ${senderId}`);
    }
  } catch (err) {
    console.error("Lỗi lưu user:", err.message);
  }
}

// ===== CHÀO USER MỚI =====
async function xuLyGetStarted(senderId) {
  await guiTinNhan(
    senderId,
    "Êy bạn có thể điền nickname Facebook của bạn cho mình được không\n\n" +
	DANH_SACH_TEN_URL
  );
}
 
 
// ===== LỊCH NHẮC ĐÓNG TIỀN =====
cron.schedule("0 13 6 * *", async () => {
  console.log("Gửi nhắc đóng tiền");
  const users = await User.find({ xacNhan: true });

  for (const user of users) {
    await User.updateOne(
      { senderId: user.senderId },
      { choDoiThanhToan: true }
    );

    const ten = user.xacNhan ? user.ten : "bạn";
    await guiTinNhan(user.senderId,
      `Hi ${ten}!\n\n` +
      `Tới hạn đóng tiền tháng này rồi bạn có muốn xài tiếp nữa không?`
    );
  }
}, { timezone: "Asia/Ho_Chi_Minh" });


// ===== WEBHOOK =====
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook xác thực thành công");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    for (const entry of body.entry) {
      const event    = entry.messaging[0];
      const senderId = event.sender.id;

      if (event.postback?.payload === "GET_STARTED") {
        await luuUserMoi(senderId);
        await xuLyGetStarted(senderId);
      } else if (event.message?.text) {
        const msg = event.message.text.trim();
        console.log(`Tin nhắn từ ${senderId}: ${msg}`);
        let user = await User.findOne({ senderId });
        if (!user) {
          await luuUserMoi(senderId);
          await xuLyGetStarted(senderId);
        } else {
          await xuLyTinNhan(senderId, msg, user);
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});


// ===== XỬ LÝ TIN NHẮN =====
async function xuLyTinNhan(senderId, userMessage, user) {

  // Lệnh thêm tên
  if (userMessage.toLowerCase().startsWith("them:")) {
    const tenMoi = userMessage.split(":")[1].trim();
    if (!ALLOWED_NAMES.includes(tenMoi)) {
      ALLOWED_NAMES.push(tenMoi);
      await guiTinNhan(senderId, `✅ Đã thêm "${tenMoi}"!\nHiện có ${ALLOWED_NAMES.length} tên.`);
    } else {
      await guiTinNhan(senderId, `⚠️ Tên "${tenMoi}" đã có rồi!`);
    }
    return;
  }

  // Lệnh xóa tên
  if (userMessage.toLowerCase().startsWith("xoa:")) {
    const tenXoa = userMessage.split(":")[1].trim();
    const index  = ALLOWED_NAMES.findIndex(
      t => t.toLowerCase() === tenXoa.toLowerCase()
    );
    if (index > -1) {
      ALLOWED_NAMES.splice(index, 1);
      await guiTinNhan(senderId, `✅ Đã xóa "${tenXoa}"!`);
    } else {
      await guiTinNhan(senderId, `❌ Không tìm thấy "${tenXoa}"!`);
    }
    return;
  }

  // Lệnh xem tên
  if (userMessage.toLowerCase() === "xem ten") {
    const ds = ALLOWED_NAMES.map((t, i) => `${i+1}. ${t}`).join("\n");
    await guiTinNhan(senderId, `📋 Danh sách tên:\n\n${ds}`);
    return;
  }

  // Lệnh xem danh sách đã xác nhận
  if (userMessage.toLowerCase() === "xem danh sach") {
    const users    = await User.find({ xacNhan: true });
    const danhSach = users.map((u, i) => `${i+1}. ${u.ten}`).join("\n");
    if (users.length === 0) {
      await guiTinNhan(senderId, "📋 Chưa có ai xác nhận.");
    } else {
      await guiTinNhan(senderId,
        `📋 Đã xác nhận:\n\n${danhSach}\n\nTổng: ${users.length} người`
      );
    }
    return;
  }

  // ===== XỬ LÝ YES/NO KHI NHẮC ĐÓNG TIỀN =====
  if (user.choDoiThanhToan) {
    const msg = userMessage.toLowerCase();

    if (msg === "yes" || msg === "có" || msg === "co") {
      // Gửi QR code
      await User.updateOne({ senderId }, { choDoiThanhToan: false });
      await guiTinNhan(senderId,
        `Vậy bạn thanh toán giúp mình nhé` 
      );
      await guiAnhQRCode(senderId);
      await guiTinNhan(senderId,
        `Có gì bạn gửi ảnh thanh toán lên nhóm giúp mình nhé`
      );

    } else if (msg === "no" || msg === "không" || msg === "khong") {
      // Xóa khỏi danh sách
      await User.updateOne(
        { senderId },
        { xacNhan: false, choDoiThanhToan: false }
      );
      const index = ALLOWED_NAMES.findIndex(
        t => t.toLowerCase() === user.ten.toLowerCase()
      );
      if (index > -1) ALLOWED_NAMES.splice(index, 1);

      await guiTinNhan(senderId,
        `Vậy bạn out tài khoản giúp mình nhe`
      );

    } else {
      // Không phải yes/no
      await guiTinNhan(senderId,
        `YES — để tiếp tục và nhận QR thanh toán\n` +
        `NO  — để hủy đăng ký`
      );
    }
    return;
  }
  // ============================================

  // Chưa xác nhận → kiểm tra tên
  if (!user.xacNhan) {
    const tenKhop = ALLOWED_NAMES.find(
      t => t.toLowerCase() === userMessage.toLowerCase()
    );
    if (tenKhop) {
      await User.updateOne({ senderId }, { ten: tenKhop, xacNhan: true });
      await guiTinNhan(senderId, `Xác nhận thành công! Xin chào ${tenKhop}!`);
      await guiTinNhan(senderId, "Có vấn đề phát sinh thì bạn nhắn cho mình nha.");
    } else {
      await guiTinNhan(senderId,
        `Tên "${userMessage}" của bạn không có trong danh sách.\n` +
        "Bạn nhập tên của bạn theo đúng hình này giúp mình\n\n" +
	DANH_SACH_TEN_URL
      );
    }
  } 
}
// ===== GỬI TIN NHẮN =====
async function guiTinNhan(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`Đã gửi: "${text.substring(0, 50)}"`);
  } catch (err) {
    console.error("Lỗi gửi tin:", err.response?.data || err.message);
  }
}

// Thêm hàm này bên dưới hàm guiTinNhan
async function guiAnhQRCode(recipientId) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: {
              url: QR_CODE_URL,
              is_reusable: true
            }
          }
        }
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log("Đã gửi QR code!");
  } catch (err) {
    console.error("Lỗi gửi QR:", err.response?.data || err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại port ${PORT}`);
  console.log("⏰ Đã bật lịch nhắc đóng tiền tự động!");
});
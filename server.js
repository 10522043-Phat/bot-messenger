require("dotenv").config();
for (const k of ["PAGE_ACCESS_TOKEN", "MONGODB_URI", "APP_SECRET", "GEMINI_API_KEY"]) {
  if (!process.env[k]) {
    console.error(`❌ Thiếu ${k} trong .env! Dừng.`);
    process.exit(1);
  }
}
const crypto   = require("crypto");
const express  = require("express");
const axios    = require("axios");
const cron     = require("node-cron");
const mongoose = require("mongoose");
const app      = express();
const { google } = require("googleapis");
const SPREADSHEET_ID_1 = process.env.SPREADSHEET_ID_1;
const SPREADSHEET_ID_2 = process.env.SPREADSHEET_ID_2;
const SHEET1_NAME    = process.env.SHEET1_NAME || "Invoice";
const SHEET2_NAME    = process.env.SHEET2_NAME || "Invoice 2";
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ===== CẤU HÌNH =====
const APP_SECRET        = process.env.APP_SECRET;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_MODEL      = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mytoken123";
const MONGODB_URI       = process.env.MONGODB_URI;
const QR_CODE_URL       = process.env.QR_CODE_URL;
const ADMIN_IDS = [
  "28079494701637950",  // Trần Agness
  "35732182966430161",          // Admin
];

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
  .then(async () => {
    console.log("Kết nối MongoDB thành công");
    const saved = await getSettings("allowedNames");
    if (saved) ALLOWED_NAMES = saved;
  })
  .catch(err => console.error("Lỗi MongoDB:", err));

const userSchema = new mongoose.Schema({
  senderId:        { type: String, required: true, unique: true },
  ten:             { type: String, default: "Chưa xác nhận" },
  xacNhan:         { type: Boolean, default: false },
  choDoiThanhToan:    { type: Boolean, default: false },
  ngonNgu:         { type: String, default: null },
  lichSuChat:      { type: [{ role: String, text: String }], default: [] },
  thoiGianThamGia: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

const settingsSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null }
});
const Settings = mongoose.model("Settings", settingsSchema);

async function getSettings(key) {
  const doc = await Settings.findOne({ key });
  return doc ? doc.value : null;
}

async function setSettings(key, value) {
  await Settings.findOneAndUpdate(
    { key },
    { value },
    { upsert: true, returnDocument: 'after' }
  );
}

async function taoSheetsClient() {
  return google.sheets({ version: "v4", auth: process.env.GOOGLE_API_KEY });
}

// Đọc 1 file sheet cụ thể theo spreadsheetId + tên tab
async function docMotSheet(sheets, spreadsheetId, sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName + "!G:J",
    });
    return res.data.values || [];
  } catch (err) {
    console.error(`Lỗi đọc sheet "${sheetName}" (${spreadsheetId}):`, err.message);
    return [];
  }
}

// Lọc tên chưa đóng từ 1 mảng rows
function locChuaDong(rows, sheet) {
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const ten = row[0].trim();

    // Bỏ qua hàng tiêu đề
    if (
      i === 0 &&
      (ten.toLowerCase().includes("tên") || ten.toLowerCase().includes("name"))
    ) continue;

    // row[3] = cột J (index 3 trong range G:J)
    const trangThai = (row[3] || "").toString().toUpperCase().trim();

    if (trangThai === "FALSE" || trangThai === "") {
      result.push({ ten, sheet }); // sheet để biết từ file nào
    }
  }
  return result;
}

// Đọc cả 2 file Google Sheet, gộp lại và loại trùng tên
async function layDanhSachChuaDong() {
  const sheets = await taoSheetsClient();

  // Đọc song song cả 2 file cùng lúc
  const [rows1, rows2] = await Promise.all([
    docMotSheet(sheets, SPREADSHEET_ID_1, SHEET1_NAME),
    docMotSheet(sheets, SPREADSHEET_ID_2, SHEET2_NAME),
  ]);

  const ds1 = locChuaDong(rows1, "File 1");
  const ds2 = locChuaDong(rows2, "File 2");

  // Gộp, loại trùng tên (case-insensitive)
  return [...ds1, ...ds2];
}

async function layDanhSachChuaXacNhan() {
  const savedNames = await getSettings("allowedNames");
  const danhSach   = savedNames || ALLOWED_NAMES;
  const daXacNhan  = await User.find({ xacNhan: true }).lean().select("ten");
  const tenDaChon  = new Set(daXacNhan.map(u => u.ten.toLowerCase()));
  return [...danhSach].filter(t => !tenDaChon.has(t.toLowerCase()));
}

// Gửi nhắc tới từng người chưa đóng
async function nhacNguoiChuaDong() {
  console.log("🔍 Check 2 Google Sheet để nhắc đóng tiền...");

  const chuaDongList = await layDanhSachChuaDong();

  if (chuaDongList.length === 0) {
    console.log("✅ Mọi người đã đóng tiền hết rồi!");
    await setSettings("lastSheetReminder", new Date().toISOString());
    return { nhac: 0, tongChuaDong: 0 };
  }

  console.log(
    `📋 Chưa đóng (${chuaDongList.length}):`,
    chuaDongList.map(x => `${x.ten} [${x.sheet}]`).join(", ")
  );

  let soNguoiNhac = 0;
  const daNhac = new Set();
  for (const { ten, sheet } of chuaDongList) {
    const escaped = ten.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user    = await User.findOne({
      xacNhan: true,
      ten: { $regex: new RegExp(`^${escaped}$`, "i") },
    });

    if (user) {
      if (daNhac.has(user.senderId)) continue;
      daNhac.add(user.senderId); 
       await guiTinNhan(
    user.senderId,
    `Hi ${user.ten}!\n\n` +
    `Mình thấy bạn chưa đóng tiền tháng này nè\n` +
    `Bạn thanh toán sớm giúp mình nhé!\n\n` +
    `YES — để nhận mã QR thanh toán\n` +
    `NO  — để hủy đăng ký`,
    true
  );
      await User.updateOne({ senderId: user.senderId }, { choDoiThanhToan: true });
      soNguoiNhac++;
    } else {
      console.log(`⚠️  "${ten}" [${sheet}] chưa có trong bot`);
    }
  }

  console.log(`✅ Đã nhắc ${soNguoiNhac}/${chuaDongList.length} người`);
  await setSettings("lastSheetReminder", new Date().toISOString());
  return { nhac: soNguoiNhac, tongChuaDong: chuaDongList.length };
}

// ===== KIỂM TRA ADMIN =====
function laAdmin(senderId) {
  return ADMIN_IDS.includes(senderId);
}

// ===== TÌM TÊN THEO SỐ / TÊN / CẢ HAI =====
function timTenTrongDanhSach(input, danhSach) {
  // Sắp xếp y hệt danh sách bot gửi cho user → số thứ tự khớp nhau
  const sorted = [...danhSach].sort(
    (a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' })
  );
  const text = input.trim();

  // Dạng có số đầu: "20", "20.", "20. Phát", "20 Phát"
  const match = text.match(/^(\d+)[.\s]*(.*)$/);
  if (match) {
    const so      = parseInt(match[1], 10);
    const phanTen = match[2].trim();
    const tenTheoSo = (so >= 1 && so <= sorted.length) ? sorted[so - 1] : null;

    if (phanTen) {
      // Gõ cả số lẫn tên → ưu tiên tên nếu tên có trong danh sách
      const tenKhop = sorted.find(t => t.toLowerCase() === phanTen.toLowerCase());
      if (tenKhop) return tenKhop;
      // Tên gõ sai chính tả nhưng số hợp lệ → tin số
      return tenTheoSo;
    }
    return tenTheoSo;
  }

  // Chỉ gõ tên
  return sorted.find(t => t.toLowerCase() === text.toLowerCase()) || null;
}

// ===== VERIFY CHỮ KÝ WEBHOOK =====
function kiemTraChuKy(req) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !req.rawBody) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", APP_SECRET)
    .update(req.rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ===== LƯU USER MỚI =====
async function luuUserMoi(senderId) {
  try {
    const truoc = await User.findOneAndUpdate(
      { senderId },
      { $setOnInsert: { senderId } },
      { upsert: true, returnDocument: 'before' }
    );
    const laMoi = truoc === null;
    if (laMoi) console.log(`Đã lưu user mới: ${senderId}`);
    return laMoi;
  } catch (err) {
    console.error("Lỗi lưu user:", err.message);
    return false;
  }
}

// ===== CHÀO USER MỚI =====
async function xuLyGetStarted(senderId) {
  await guiTinNhan(
    senderId,
    "Êy bạn có thể điền nickname Facebook của bạn cho mình được không\n\n" +
    "Bạn tìm tên mình trong danh sách dưới đây nhé:"
  );
    await guiAnhDanhSachTen(senderId);
}
 
// ===== LỊCH NHẮC ĐÓNG TIỀN =====
cron.schedule("15 12 6 * *", async () => {
  console.log("Gửi nhắc đóng tiền");
  await setSettings("dangThuTien", true);
  await setSettings("lastSheetReminder", new Date().toISOString());
  const users = await User.find({ xacNhan: true });
  for (const user of users) {
    await User.updateOne({ senderId: user.senderId }, { choDoiThanhToan: true });

    const ten = user.xacNhan ? user.ten : "bạn";
    await guiTinNhan(user.senderId,
     `Hi ${ten}!\n\n` +
     `Tới hạn đóng tiền tháng này rồi bạn có muốn xài tiếp nữa không?\n\n` +
     `YES — để tiếp tục\n` +
     `NO  — để hủy đăng ký`,
     true
);
  }
}, { timezone: "Asia/Ho_Chi_Minh" });

// ===== CRON NHẮC MỖI 2 NGÀY DỰA TRÊN GOOGLE SHEETS =====
// Chạy lúc 12h15 trưa vào các ngày chẳn (2, 4, 6,... 16),
cron.schedule("15 12 2,4,8,10,12,14,16 * *", async () => {
  // Kiểm tra xem đã đủ 48 tiếng kể từ lần nhắc trước chưa
  const lastRun = await getSettings("lastSheetReminder");
  if (lastRun) {
    const diffHours = (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60);
    if (diffHours < 47) {
      console.log(`⏳ Mới nhắc ${Math.floor(diffHours)}h trước, chưa đủ 2 ngày`);
      return;
    }
  }
  const dangThu = await getSettings("dangThuTien");
  if (!dangThu) {
    console.log("⏸ Kỳ thu tiền đã đóng, bỏ qua.");
    return;
  }

  await nhacNguoiChuaDong();
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

app.post("/webhook", (req, res) => {
  if (!kiemTraChuKy(req)) {
    console.warn("⚠️ Webhook chữ ký sai — request giả mạo?");
    return res.sendStatus(403);
  }
  const body = req.body;
  if (body.object !== "page") {
    return res.sendStatus(404);
  }

  res.status(200).send("EVENT_RECEIVED");
  (async () => {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        try {
	if (event.postback?.payload === "GET_STARTED") {
  	const laMoi = await luuUserMoi(senderId);
  	if (laMoi) {
 	   await xuLyGetStarted(senderId);
 	 } else {
 	   const u = await User.findOne({ senderId });
  	  if (u && !u.xacNhan) await xuLyGetStarted(senderId);  // chưa xác nhận → hướng dẫn lại
  	  else await guiTinNhan(senderId, "Bạn đã đăng ký rồi nha! Có gì cần cứ nhắn mình 😊");
 	 }
	}
	    else if (event.message?.text) {
            const msg = event.message.text.trim();
            console.log(`Tin nhắn từ ${senderId}: ${msg}`);
            let user = await User.findOne({ senderId });
            if (!user) {
              const laMoi = await luuUserMoi(senderId);
              if (laMoi) await xuLyGetStarted(senderId);
            } else {
              await xuLyTinNhan(senderId, msg, user);
            }
          }
        } catch (err) {
          console.error("Lỗi xử lý event:", err.message);
        }
      }
    }
  })();
});

// ===== XỬ LÝ TIN NHẮN =====
async function xuLyTinNhan(senderId, userMessage, user) {

  // ===== LỆNH ADMIN =====
const adminLenh = [
  "xem danh sach", "xem ten", "bat thu tien",
  "tat thu tien", "trang thai",
  "kiem tra sheet", "xem chua dong"
];
  const laLenhAdmin =
    adminLenh.includes(userMessage.toLowerCase()) ||
    userMessage.toLowerCase().startsWith("them:") ||
    userMessage.toLowerCase().startsWith("xoa:");

  if (laLenhAdmin) {
    if (!laAdmin(senderId)) {
      await guiTinNhan(senderId, "Bạn không có quyền dùng lệnh này!");
      return;
    }
  }

  // Lệnh thêm tên
  if (userMessage.toLowerCase().startsWith("them:")) {
    const tenMoi = userMessage.slice(5).trim();
    if (!tenMoi) {
      await guiTinNhan(senderId, "⚠️ Thiếu tên! Gõ: them:Tên Người");
      return;
    }
    const daCoRoi = ALLOWED_NAMES.some(t => t.toLowerCase() === tenMoi.toLowerCase()); // ← thay
    if (!daCoRoi) {
      ALLOWED_NAMES.push(tenMoi);
      ALLOWED_NAMES.sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
    await setSettings("allowedNames", ALLOWED_NAMES);
    await guiTinNhan(senderId, `✅ Đã thêm "${tenMoi}"!\nHiện có ${ALLOWED_NAMES.length} tên.`);
  } else {
    await guiTinNhan(senderId, `⚠️ Tên "${tenMoi}" đã có rồi!`);
  }
  return;
}

  // Lệnh xóa tên
  if (userMessage.toLowerCase().startsWith("xoa:")) {
    const tenXoa = userMessage.slice(4).trim();
    if (!tenXoa) {
      await guiTinNhan(senderId, "⚠️ Thiếu tên! Gõ: xoa:Tên Người");
      return;
    }
    const index  = ALLOWED_NAMES.findIndex(
      t => t.toLowerCase() === tenXoa.toLowerCase()
    );
    if (index > -1) {
      ALLOWED_NAMES.splice(index, 1);
      ALLOWED_NAMES.sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
      await setSettings("allowedNames", ALLOWED_NAMES);
      const escaped = tenXoa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const xoaUser = await User.findOneAndDelete({
       ten: { $regex: new RegExp(`^${escaped}$`, "i") }
    });
    if (xoaUser) {
      await guiTinNhan(senderId, `✅ Đã xóa "${tenXoa}" khỏi danh sách và hệ thống!`);
    } else {
      await guiTinNhan(senderId, `✅ Đã xóa "${tenXoa}" khỏi danh sách!\n⚠️ Người này chưa đăng ký bot.`);
    }
  } else {
    await guiTinNhan(senderId, `❌ Không tìm thấy "${tenXoa}"!`);
  }
  return;
}

  // Lệnh xem tên
    if (userMessage.toLowerCase() === "xem ten") {
     const savedNames = await getSettings("allowedNames"); // ✅ đọc từ DB
     const danhSach = savedNames || ALLOWED_NAMES;
     const ds = [...danhSach]
      .sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }))
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n");
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

 // Lệnh xem danh sách chưa đóng từ Sheet (không nhắc)
  if (userMessage.toLowerCase() === "xem chua dong") {
    const list = await layDanhSachChuaDong();
    if (list.length === 0) {
      await guiTinNhan(senderId, "✅ Mọi người đã đóng tiền hết rồi!");
    } else {
      const ds = list
        .map((x, i) => `${i + 1}. ${x.ten}  [${x.sheet}]`)
        .join("\n");
      await guiTinNhan(
        senderId,
        `📋 Chưa đóng tiền (${list.length} người):\n\n${ds}`
      );
    }
    return;
  }

  // Lệnh check Sheet ngay và nhắc luôn (không chờ cron)
if (userMessage.toLowerCase() === "kiem tra sheet") {
  const dangThu = await getSettings("dangThuTien");
  if (!dangThu) {
    await guiTinNhan(senderId, "⏸ Kỳ thu tiền đang tắt! Gõ 'bat thu tien' trước.");
    return;
  }
  await guiTinNhan(senderId, "🔍 Đang check Google Sheets...");
  const { nhac, tongChuaDong } = await nhacNguoiChuaDong();
  await guiTinNhan(
    senderId,
    tongChuaDong === 0
      ? "✅ Mọi người đã đóng tiền hết rồi!"
      : `✅ Đã nhắc ${nhac}/${tongChuaDong} người chưa đóng tiền!`
  );
  return;
}
  // ============================================

  // Lệnh bật/tắt kỳ thu tiền thủ công
  if (userMessage.toLowerCase() === "bat thu tien") {
    await setSettings("dangThuTien", true);
    await setSettings("lastSheetReminder", null);
    await guiTinNhan(senderId, "✅ Đã bật kỳ thu tiền!");
    return;
  }

  if (userMessage.toLowerCase() === "tat thu tien") {
    await setSettings("dangThuTien", false);
    await guiTinNhan(senderId, "✅ Đã tắt kỳ thu tiền!");
    return;
  }

  if (userMessage.toLowerCase() === "trang thai") {
    const dangThuTien = await getSettings("dangThuTien");
    await guiTinNhan(senderId, `📊 Kỳ thu tiền: ${dangThuTien ? "🟢 Đang bật" : "🔴 Đang tắt"}`);
    return;
  }

  if (user.choDoiThanhToan) {
    const msg = userMessage.toLowerCase();

 // ===== XỬ LÝ YES/NO KHI NHẮC ĐÓNG TIỀN =====
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
      await User.findOneAndDelete({ senderId });
      const index = ALLOWED_NAMES.findIndex(
       t => t.toLowerCase() === user.ten.toLowerCase()
  );
       if (index > -1) ALLOWED_NAMES.splice(index, 1);
      ALLOWED_NAMES.sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
      await setSettings("allowedNames", ALLOWED_NAMES);
      await guiTinNhan(senderId,
        `Vậy bạn out tài khoản giúp mình nhe.\n` +
        `Nếu có góp ý gì về dịch vụ, bạn nhắn cho admin Trần Agness nha, cảm ơn bạn nhiều!`
      );
      for (const adminId of ADMIN_IDS) {
        await guiTinNhan(adminId, `🔔 "${user.ten}" đã hủy đăng ký. Nhớ xóa khỏi Google Sheet!`);
      }

    } else {
      // Không phải yes/no
      await guiTinNhan(senderId,
        `YES — để tiếp tục và nhận QR thanh toán\n` +
        `NO  — để hủy đăng ký`
      );
    }
    return;
  }

  // Chưa xác nhận → kiểm tra tên
  if (!user.xacNhan) {
    const danhSachHienThi = await layDanhSachChuaXacNhan();
    const tenKhop = timTenTrongDanhSach(userMessage, danhSachHienThi);

    if (tenKhop) {
      const daCoNguoi = await User.findOne({ ten: tenKhop, xacNhan: true });
      if (daCoNguoi) {
        await guiTinNhan(senderId,
          `Tên "${tenKhop}" vừa được người khác xác nhận rồi!\n` +
          `Nếu đây đúng là bạn, liên hệ Trần Agness để xử lý nhé.`
        );
        return;
      }
      await User.updateOne({ senderId }, { ten: tenKhop, xacNhan: true });
      await guiTinNhan(senderId, `Xác nhận thành công! Xin chào ${tenKhop}!`);

      const dangThuTien = await getSettings("dangThuTien");
      if (dangThuTien) {
        const chuaDong = await layDanhSachChuaDong();
        const daDong   = !chuaDong.some(
          x => x.ten.toLowerCase() === tenKhop.toLowerCase()
        );
        if (daDong) {
          await guiTinNhan(senderId, "Cám ơn bạn đã kích hoạt mình nhé!");
        } else {
          await User.updateOne({ senderId }, { choDoiThanhToan: true });
          await guiTinNhan(senderId,
            `Tháng này đang thu tiền rồi bạn có muốn tiếp tục không?\n\n` +
            `YES — để tiếp tục\n` +
            `NO  — để hủy đăng ký`
          );
        }
      } else {
        await guiTinNhan(senderId, "Có vấn đề phát sinh thì bạn nhắn cho mình nha.");
      }
    } else {
      await guiTinNhan(senderId,
        `Tên "${userMessage}" không có trong danh sách.\n` +
        `Bạn tìm tên mình trong danh sách này nhé:`
      );
      await guiAnhDanhSachTen(senderId);
    }
  } else if (user.xacNhan && !user.choDoiThanhToan) {
    const msg = userMessage.toLowerCase();

// Cho phép đổi ngôn ngữ bất kỳ lúc nào
    const xinTiengViet = ["vi", "tiếng việt", "tieng viet", "vietnamese", "switch to vietnamese"]
      .some(t => msg === t || (msg.includes("vietnamese") && (msg.includes("switch") || msg.includes("change") || msg.includes("speak"))) || msg.includes("chuyển qua tiếng việt") || msg.includes("nói tiếng việt"));
    if (xinTiengViet) {
      await User.updateOne({ senderId }, { ngonNgu: "vi" });
      await guiTinNhan(senderId, "OK mình sẽ hỗ trợ bằng tiếng Việt nha! 🇻🇳\nBạn cần giúp gì?");
      return;
    }

    const xinTiengAnh = ["en", "english"]
      .some(t => msg === t) || (msg.includes("english") && (msg.includes("switch") || msg.includes("change") || msg.includes("speak"))) || msg.includes("chuyển qua tiếng anh") || msg.includes("nói tiếng anh");
    if (xinTiengAnh) {
      await User.updateOne({ senderId }, { ngonNgu: "en" });
      await guiTinNhan(senderId, "Got it, I'll assist you in English! 🇬🇧\nHow can I help?");
      return;
    }

    if (msg === "reset" || msg === "quên đi" || msg === "quen di") {
      await User.updateOne({ senderId }, { lichSuChat: [] });
      await guiTinNhan(senderId,
        user.ngonNgu === "en" ? "Memory cleared! Fresh start 🧹" : "Đã xóa trí nhớ! Bắt đầu lại nha 🧹"
      );
      return;
    }

    // Đã có ngôn ngữ → Gemini trả lời
    const traLoi = await hoiGemini(userMessage, user.ten, user.ngonNgu, user.lichSuChat || []);
    const fallback = user.ngonNgu === "en"
      ? "How can I help you? 😊"
      : "Có gì cần mình hỗ trợ không bạn? 😊";
    await guiTinNhan(senderId, traLoi || fallback);
    if (traLoi) {
      await User.updateOne(
        { senderId },
        {
          $push: {
            lichSuChat: {
              $each: [
                { role: "user",  text: userMessage },
                { role: "model", text: traLoi }
              ],
              $slice: -20
            }
          }
        }
      );
    }
  }
}

// ===== GỬI TIN NHẮN =====
async function guiTinNhan(recipientId, text, dungTag = false) {
  const payload = { recipient: { id: recipientId }, message: { text } };
  if (dungTag) {
    payload.messaging_type = "MESSAGE_TAG";
    payload.tag = "CONFIRMED_EVENT_UPDATE";
  }
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      payload,
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`Đã gửi: "${text.substring(0, 50)}"`);
  } catch (err) {
    console.error("Lỗi gửi tin:", err.response?.data || err.message);
  }
}

async function hoiGemini(cauHoi, tenUser, ngonNgu = "vi", lichSu = []) {
  const yeuCauNgonNgu = ngonNgu === "en"
   ? "Always reply in English only, naturally and friendly. Keep it under 3 sentences."
   : "Luôn trả lời bằng tiếng Việt, tự nhiên và thân thiện. Không quá 3 câu.";

  const contents = [
    ...lichSu.map(m => ({
      role: m.role,
      parts: [{ text: m.text }]
    })),
    { role: "user", parts: [{ text: cauHoi }] }
  ];

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
     {
        contents,
       systemInstruction: {
         parts: [{
           text:
             "Bạn là trợ lý hỗ trợ của nhóm share tài khoản AI (Claude). " +
             "Tên bạn là Agness Bot, phong cách thân thiện, vui vẻ, dùng emoji vừa phải.\n\n" +
 
             "=== THÔNG TIN NHÓM ===\n" +
             "- Nhóm cung cấp tài khoản Claude AI dùng chung, thu phí hàng tháng.\n" +
             "- Đóng tiền vào ngày 6 hàng tháng.\n" +
             "- Thanh toán qua QR code do admin gửi.\n\n" +
 
             "=== LÝ DO CÓ NHIỀU TÀI KHOẢN ===\n" +
             "Nếu được hỏi tại sao có nhiều tài khoản, giải thích: " +
             "Do giới hạn của Claude, mỗi tài khoản có quota sử dụng nhất định trong ngày. " +
             "Nhóm dùng nhiều tài khoản luân phiên để đảm bảo mọi người luôn có tài khoản dùng được, " +
             "không bị gián đoạn khi một tài khoản hết quota.\n\n" +
 
             "=== HƯỚNG DẪN DÙNG CLAUDE ===\n" +
             "Nếu được hỏi về cách dùng Claude hoặc các skill, hướng dẫn:\n" +
             "- Vào claude.ai, đăng nhập bằng tài khoản được cung cấp.\n" +
             "- Dùng Projects để lưu context dài hạn cho công việc.\n" +
             "- Viết prompt rõ ràng: nêu rõ vai trò, yêu cầu, định dạng mong muốn.\n" +
             "- Có thể upload file dưới dạng markdown, ảnh để Claude phân tích.\n" +
             "- Hiện có sẵn các skill /humanizer -> giúp 0% AI detect, và /cavemen -> giúp tiết kiệm token.\n\n" +
             "-Cách kiểm tra token bằng cách vào setting, vào usage bạn sẽ thấy lượng token còn lại.\n" +
             "- Nếu cần hướng dẫn chi tiết hơn, bảo người dùng nhắn admin.\n\n" +
 
             "=== CHAT TỰ DO / TÁN GẪU ===\n" +
             "Bạn được phép trả lời vui vẻ các câu hỏi ngẫu nhiên, tán gẫu, hỏi thăm, " +
             "câu hỏi kiến thức thông thường, hay chủ đề không liên quan đến nhóm. " +
             "Trả lời tự nhiên như một người bạn, hài hước nhẹ nhàng nếu phù hợp. " +
             "Ví dụ: hỏi thời tiết, ăn gì, kể chuyện cười, hỏi về AI, tám chuyện... đều OK! 😄\n\n" +
 
	     "=== ĐỔI NGÔN NGỮ ===\n" +
             "Bạn KHÔNG thể tự đổi ngôn ngữ. Nếu người dùng yêu cầu đổi ngôn ngữ, " +
             "hướng dẫn họ: gõ 'vi' để chuyển sang tiếng Việt, gõ 'en' để chuyển sang tiếng Anh. " +
             "Hệ thống sẽ tự chuyển khi họ gõ đúng từ khóa.\n\n" +

             "=== QUY TẮC TRẢ LỜI ===\n" +
             "- Không quá 3-4 câu mỗi lần, trừ khi hướng dẫn kỹ thuật cần nhiều bước.\n" +
             "- Câu hỏi về chính sách nhóm mà không rõ: nhờ liên hệ admin.\n" +
             "- Không bịa thông tin về giá, tài khoản, hay chính sách nhóm.\n" +
             yeuCauNgonNgu
         }]
       }
     }
   );
    return res.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error("Lỗi Gemini:", err.response?.data?.error?.message || err.message);
    return null;
  }
}


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

async function guiAnhDanhSachTen(recipientId) {
  const chuaXacNhan = await layDanhSachChuaXacNhan();

  if (chuaXacNhan.length === 0) {
    await guiTinNhan(recipientId,
      "Tất cả thành viên đã xác nhận rồi!\n" +
      "Nếu không thấy tên mình, nhắn admin Trần Agness nhé."
    );
    return;
  }

  const ds = [...chuaXacNhan]
    .sort((a, b) => a.localeCompare(b, "vi", { sensitivity: "base" }))
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  await guiTinNhan(recipientId, `Danh sách thành viên chưa đăng ký:\n\n${ds}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại port ${PORT}`);
  console.log("⏰ Đã bật lịch nhắc đóng tiền tự động!");
});
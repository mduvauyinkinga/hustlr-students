export function normalizePhone(phone) {
  phone = (phone ?? "").replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "27" + phone.substring(1);
  }

  if (phone.startsWith("27")) {
    return phone;
  }

  return null;
}


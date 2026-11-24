import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { api, type Row } from "../lib/api";
import { countLabel } from "../lib/counts";
export function ViewCount({ titleId }: { titleId: string }) {
  const [data, setData] = useState<Row | null>(null);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    setData(null);
    const read = () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      api("/titles/" + titleId + "/views", {
        auth: false,
        signal: controller.signal,
      })
        .then((r) => {
          if (active) setData(r.data);
        })
        .catch(() => {});
    };
    read();
    const timer = window.setInterval(read, 30000);
    document.addEventListener("visibilitychange", read);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [titleId]);
  if (!data) return null;
  return (
    <p
      className="view-count"
      data-testid="title-view-count"
      title={
        "Tính từ " +
        (data.measurementStartedAt
          ? new Date(data.measurementStartedAt).toLocaleString("vi-VN")
          : "khi bật thống kê") +
        ". Xem đủ 120 giây hoặc nửa video ngắn; mỗi định danh/phim/ngày UTC tối đa một lượt. Số liệu cập nhật sau xử lý."
      }
    >
      <Eye size={16} aria-hidden="true" />
      <strong>{countLabel(data.views)}</strong> lượt xem hợp lệ
    </p>
  );
}

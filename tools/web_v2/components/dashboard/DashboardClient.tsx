"use client";

export function DashboardClient() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex min-h-screen max-w-screen-2xl flex-col px-5 py-6 sm:px-8 lg:py-8">
        <div className="mb-4 flex items-center justify-between"><h1 className="text-lg font-semibold">Parking map</h1><span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-200">Waiting for backend image</span></div>
        <div className="grid min-h-[80vh] w-full place-items-center rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-xl">
          <div><div className="mx-auto grid size-20 place-items-center rounded-full border border-slate-600 text-4xl">⌖</div><h2 className="mt-5 text-xl font-semibold">Parking map</h2><p className="mt-2 max-w-md text-sm text-slate-400">รอรูปและผลการวิเคราะห์ล่าสุดจาก backend เพื่อแสดงตำแหน่งรถและพื้นที่ว่าง</p></div>
        </div>
      </section>
    </main>
  );
}

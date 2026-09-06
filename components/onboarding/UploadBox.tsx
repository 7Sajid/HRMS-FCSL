"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DocumentKind } from "@prisma/client";
import { Badge } from "@/components/ui/Feedback";
import { formatBytes } from "@/lib/uploads";
import { IconUpload } from "@/components/icons";

export type BoxDocument = {
  id: string;
  originalName: string;
  size: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
};

/**
 * One labelled box. §4: "As each file goes in, the box turns green."
 *
 * Uses XHR rather than fetch because a branch office on a slow connection
 * sending a ten-megabyte scan needs a progress bar, and fetch cannot report
 * upload progress.
 */
export function UploadBox({
  kind,
  label,
  note,
  accepts,
  required,
  multiple,
  satisfied,
  locked,
  rejectionReason,
  capturesDates,
  documents,
}: {
  kind: DocumentKind;
  label: string;
  note: string;
  accepts: string[];
  required: boolean;
  multiple: boolean;
  satisfied: boolean;
  locked: boolean;
  rejectionReason: string;
  capturesDates: boolean;
  documents: BoxDocument[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const upload = (file: File) => {
    setError("");
    if (capturesDates && (!issueDate || !expiryDate)) {
      setError("Enter the issue date and expiry date first.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    if (capturesDates) {
      body.set("issueDate", issueDate);
      body.set("expiryDate", expiryDate);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setPercent(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setPercent(null);
      if (inputRef.current) inputRef.current.value = "";
      if (xhr.status >= 200 && xhr.status < 300) {
        startTransition(() => router.refresh());
        return;
      }
      // Every refusal from the server is a sentence meant for a person, so
      // show it rather than a status code.
      try {
        setError(JSON.parse(xhr.responseText).error ?? "That upload did not work.");
      } catch {
        setError(
          xhr.status === 413
            ? "That file is too large."
            : "That upload did not work. Please try again.",
        );
      }
    };
    xhr.onerror = () => {
      setPercent(null);
      setError("The connection dropped. Please try again.");
    };
    xhr.send(body);
  };

  const tone = satisfied ? "border-success-500/40 bg-success-50/30" : "border-ink-300/60 bg-white";

  return (
    <div className={`rounded-xl border p-4 ${rejectionReason ? "border-red-300 bg-red-50/40" : tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">
            {label}
            {required ? <span className="ml-1 text-brand-500">*</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{note}</p>
        </div>
        {satisfied ? (
          <Badge tone="success">Uploaded</Badge>
        ) : required ? (
          <Badge tone="neutral">Needed</Badge>
        ) : (
          <Badge tone="neutral">Optional</Badge>
        )}
      </div>

      {rejectionReason && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          <strong className="font-medium">HR sent this back:</strong> {rejectionReason}
        </p>
      )}

      {documents.length > 0 && (
        <ul className="mt-3 space-y-1">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-2 text-xs text-ink-500">
              <span className="truncate">{doc.originalName}</span>
              <span className="shrink-0 text-ink-400">{formatBytes(doc.size)}</span>
              {doc.status === "ACCEPTED" && <Badge tone="success">Accepted</Badge>}
              {doc.status === "PENDING" && <Badge tone="warn">With HR</Badge>}
              {doc.status === "REJECTED" && <Badge tone="danger">Sent back</Badge>}
            </li>
          ))}
        </ul>
      )}

      {capturesDates && !locked && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-500">
            Issue date
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-300/60 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="text-xs text-ink-500">
            Expiry date
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-300/60 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>
      )}

      {percent !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-300/30">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      {locked ? (
        <p className="mt-3 text-xs text-ink-400">
          HR has accepted this. Ask HR if it needs replacing.
        </p>
      ) : (
        <div className="mt-3">
          <input
            ref={inputRef}
            id={`file-${kind}`}
            type="file"
            accept={accepts.join(",")}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <label
            htmlFor={`file-${kind}`}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-surface"
          >
            <IconUpload className="h-4 w-4" />
            {documents.length && multiple ? "Add another" : documents.length ? "Replace" : "Choose file"}
          </label>
        </div>
      )}
    </div>
  );
}

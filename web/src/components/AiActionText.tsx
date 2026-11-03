import { Fragment } from 'react';
import { Link } from 'react-router-dom';

const ROUTE_PATTERN =
  /\/(?:my-reports|intelligence\/predictions|compliance\/documents|ai-analyst|data-sources|atmosphere|notifications|simulation|dashboard|incidents|compliance|settings|profile|reports|alerts|city|map|report|about|privacy|terms)(?:\/[A-Za-z0-9_-]+)*/g;

const ROUTE_TEST =
  /^\/(?:my-reports|intelligence\/predictions|compliance\/documents|ai-analyst|data-sources|atmosphere|notifications|simulation|dashboard|incidents|compliance|settings|profile|reports|alerts|city|map|report|about|privacy|terms)(?:\/[A-Za-z0-9_-]+)*$/;

export function AiActionText({ text }: { text: string }) {
  const parts = text.split(ROUTE_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        ROUTE_TEST.test(part) ? (
          <Link key={index} to={part} className="font-semibold text-[#3f7d2a] underline underline-offset-2 hover:text-[#2f5f20]">
            {part}
          </Link>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

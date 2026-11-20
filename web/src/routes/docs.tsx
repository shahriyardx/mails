import { Link } from "react-router";
import { Button, EmptyState } from "@/components/kit";

/** /docs/*: the markdown viewer for web/src/docs lands here in phase 2. */
export function Component() {
  return (
    <div className="grid h-dvh place-items-center p-4">
      <EmptyState
        icon="menu_book"
        title="Docs are coming soon"
        body="The guides and API reference will be readable here."
        action={
          <Button render={<Link to="/mail/all/inbox" />} nativeButton={false} icon="arrow_back">
            Back to mail
          </Button>
        }
      />
    </div>
  );
}

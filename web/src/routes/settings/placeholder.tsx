import { Link } from "react-router";
import { Button } from "@/components/kit";
import { emptyBox } from "./parts";

/** Shown for a settings page that has no `load` in pages.ts yet (the layout shows its title). */
export function Component() {
  return (
    <div className={emptyBox}>
      <p className="text-muted-foreground">
        This page is not built yet. The API behind it already works.
      </p>
      <Button
        variant="primary"
        icon="menu_book"
        className="mt-4"
        render={<Link to="/docs" />}
        nativeButton={false}
      >
        Read the docs
      </Button>
    </div>
  );
}

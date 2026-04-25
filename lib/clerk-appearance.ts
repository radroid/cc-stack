import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

export const clerkProviderAppearance: Appearance = {
  variables: {
    colorPrimary: "oklch(0.205 0 0)",
    borderRadius: "0.625rem",
  },
};

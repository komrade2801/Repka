import { Toaster } from "sonner"

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme="light"
      toastOptions={{
        classNames: {
          toast: "font-[inherit] text-sm",
        },
      }}
    />
  )
}

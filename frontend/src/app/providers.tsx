import { useState, type ReactNode } from 'react'
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { ProveedorEmpresa, ProveedorMonedas } from './contexto'
import { ProveedorSesion } from './sesion'
import { esReintentable } from '@/shared/api/client'
import { notificar } from '@/shared/ui/avisos'
import { Notificaciones } from '@/shared/ui/Notificaciones'

export function Providers({ children }: { children: ReactNode }) {
  const [cliente] = useState(
    () =>
      new QueryClient({
        // Cada operación que termina bien se confirma con un aviso breve. El
        // texto lo declara la propia mutación (`meta.exito`), junto a lo que
        // hace; las que no declaran nada (una consulta con forma de
        // mutación, como calcular una propuesta) no avisan.
        mutationCache: new MutationCache({
          onSuccess: (_datos, _variables, _contexto, mutacion) => {
            const exito = mutacion.meta?.exito
            if (exito) notificar(exito)
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (intentos, error) => {
              // Un error de negocio (periodo cerrado, asiento descuadrado) no
              // mejora reintentando. Un corte de red o un 502, sí.
              if (!esReintentable(error)) return false
              return intentos < 2
            },
          },
          mutations: { retry: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={cliente}>
      <ProveedorSesion>
        <ProveedorMonedas>
          <ProveedorEmpresa>{children}</ProveedorEmpresa>
        </ProveedorMonedas>
      </ProveedorSesion>
      <Notificaciones />
    </QueryClientProvider>
  )
}

export const IC={lamp:'<path d="M35 40h30l8 25H27z"/><path d="M50 65v22M38 87h24"/>',vase:'<path d="M42 18h16M44 18c0 14-18 18-18 42a24 24 0 0 0 48 0c0-24-18-28-18-42"/>',cushion:'<rect x="18" y="30" width="64" height="42" rx="14"/><path d="M30 42c8 6 32 6 40 0"/>',candle:'<rect x="36" y="46" width="28" height="40" rx="3"/><path d="M50 22c8 8 8 14 0 18-8-4-8-10 0-18z"/>',plant:'<path d="M34 62h32l-5 25H39z"/><path d="M50 62V38M50 50c-14 0-18-12-18-20 12 0 18 8 18 20zM50 46c10 0 16-8 16-16-10 0-16 6-16 16z"/>',frame:'<rect x="24" y="24" width="52" height="52"/><path d="M32 66l14-16 10 10 8-8 6 14z"/>',mug:'<path d="M28 36h40v32a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8z"/><path d="M68 44h8a8 8 0 0 1 0 16h-8"/>',basket:'<path d="M22 44h56l-6 34H28z"/><path d="M34 44c0-20 32-20 32 0"/>',shelf:'<path d="M20 40h60M20 70h60M30 40V26h14v14M54 70V54h16v16"/>',blanket:'<path d="M20 30h60v40H20zM20 50h60M40 30v40M60 30v40"/>',mirror:'<ellipse cx="50" cy="44" rx="24" ry="30"/><path d="M50 74v14"/>',clock:'<circle cx="50" cy="50" r="28"/><path d="M50 32v18l12 8"/>'};
export const svg=k=>`<svg viewBox="0 0 100 100" aria-hidden="true">${IC[k]}</svg>`;
export const P=[
{id:1,n:'Lámpara de mesa Arena',c:'Iluminación',p:2890,i:'lamp',t:'#BC906A',d:'Pantalla de lino y base de madera. Luz cálida para living o mesa de luz.',m:'Madera y lino',s:'38 × 22 cm'},
{id:2,n:'Jarrón cerámico Duna',c:'Decoración',p:1450,i:'vase',t:'#A67C5B',d:'Cerámica esmaltada hecha a mano, ideal para ramas secas.',m:'Cerámica',s:'28 × 16 cm'},
{id:3,n:'Almohadón lino Nube',c:'Textiles',p:890,i:'cushion',t:'#C9A98A',d:'Funda de lino lavado con cierre oculto y relleno incluido.',m:'Lino 100%',s:'45 × 45 cm'},
{id:4,n:'Vela de soja Cedro',c:'Velas y aromas',p:680,i:'candle',t:'#8C6B4F',d:'Aroma a cedro y vainilla. Más de 40 horas de duración.',m:'Cera de soja',s:'250 g'},
{id:5,n:'Maceta Terra con plato',c:'Plantas',p:790,i:'plant',t:'#7E8C6D',d:'Maceta de barro con plato a juego y drenaje.',m:'Barro cocido',s:'Ø 18 cm'},
{id:6,n:'Cuadro Montaña marco roble',c:'Decoración',p:2150,i:'frame',t:'#B08968',d:'Lámina impresa en papel de algodón con marco de roble.',m:'Roble y papel',s:'40 × 50 cm'},
{id:7,n:'Set de tazas Barro (x4)',c:'Cocina',p:1590,i:'mug',t:'#9C7352',d:'Cuatro tazas de gres aptas para lavavajillas y microondas.',m:'Gres',s:'300 ml c/u'},
{id:8,n:'Canasto trenzado',c:'Organización',p:1320,i:'basket',t:'#D0AE8B',d:'Canasto de fibra natural para mantas, juguetes o ropa.',m:'Fibra natural',s:'35 × 30 cm'},
{id:9,n:'Estante flotante Roble',c:'Organización',p:1980,i:'shelf',t:'#8F6A48',d:'Estante con soportes ocultos. Incluye tarugos y tornillos.',m:'Roble macizo',s:'60 × 18 cm'},
{id:10,n:'Manta tejida Camel',c:'Textiles',p:2390,i:'blanket',t:'#BF9468',d:'Manta de algodón tejida, suave y liviana todo el año.',m:'Algodón',s:'130 × 170 cm'},
{id:11,n:'Espejo ovalado pie',c:'Decoración',p:4200,i:'mirror',t:'#A88A6C',d:'Espejo ovalado con marco de madera y apoyo trasero.',m:'Madera y vidrio',s:'150 × 50 cm'},
{id:12,n:'Reloj de pared Mínimo',c:'Decoración',p:1190,i:'clock',t:'#7A6350',d:'Mecanismo silencioso, esfera clara y aguja fina.',m:'Madera',s:'Ø 30 cm'}];

// Convierte productos de PostgreSQL
// al formato utilizado por nuestra tienda React.

export function adaptarProductos(productosDB) {

  return productosDB.map(producto => {

    // Buscamos el producto original para recuperar
    // su icono, color, material y medidas.

    const original = P.find(
      p => p.id === producto.id
    );

    return {
      id: producto.id,

      n: producto.nombre,

      c: producto.categoria || "Sin categoría",

      p: Number(producto.precio),

      r: producto.precio_rebaja == null ? null : Number(producto.precio_rebaja),

      stock: Number(producto.stock),

      i: original?.i || "vase",

      t: original?.t || "#BC906A",

      d: producto.descripcion || "",

      m: original?.m || "No especificado",

      s: original?.s || "No especificado",

      imagen: producto.imagen || producto.imagenes?.[0]?.url || null,

      imagenes: producto.imagenes || []
    };

  });

}

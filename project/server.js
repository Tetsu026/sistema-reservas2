const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Inicializar banco de dados
const db = new sqlite3.Database('./database.db');

// Criar tabelas se não existirem
db.serialize(() => {
  // Tabela de reservas
  db.run(`CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    mesa INTEGER NOT NULL,
    pessoas INTEGER NOT NULL,
    responsavel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reservada'
  )`);

  // Tabela de garçons
  db.run(`CREATE TABLE IF NOT EXISTS garcons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL
  )`);

  // Tabela de confirmações
  db.run(`CREATE TABLE IF NOT EXISTS confirmacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reserva_id INTEGER,
    garcom_id INTEGER,
    FOREIGN KEY (reserva_id) REFERENCES reservas(id),
    FOREIGN KEY (garcom_id) REFERENCES garcons(id)
  )`);

  // Inserir dados iniciais (seed)
  db.get("SELECT COUNT(*) as count FROM garcons", (err, row) => {
    if (row.count === 0) {
      const garcons = [
        "João Silva",
        "Maria Santos", 
        "Pedro Oliveira"
      ];
      
      garcons.forEach(nome => {
        db.run("INSERT INTO garcons (nome) VALUES (?)", [nome]);
      });
      
      console.log("Dados iniciais inseridos: 3 garçons");
    }
  });
});

// Função para padronizar respostas
const sendResponse = (res, success, message, data = null) => {
  res.json({
    ok: success,
    message: message,
    data: data
  });
};

// ROTAS DA API

// POST /api/reservas - Criar reserva
app.post('/api/reservas', (req, res) => {
  const { data, hora, mesa, pessoas, responsavel } = req.body;
  
  // Validações básicas
  if (!data || !hora || !mesa || !pessoas || !responsavel) {
    return sendResponse(res, false, "Todos os campos são obrigatórios");
  }

  if (pessoas < 1 || pessoas > 20) {
    return sendResponse(res, false, "Número de pessoas deve estar entre 1 e 20");
  }

  if (mesa < 1 || mesa > 10) {
    return sendResponse(res, false, "Mesa deve estar entre 1 e 10");
  }

  // Verificar se mesa já está reservada no mesmo dia/hora
  db.get(
    "SELECT id FROM reservas WHERE data = ? AND hora = ? AND mesa = ? AND status != 'cancelada'",
    [data, hora, mesa],
    (err, row) => {
      if (err) {
        return sendResponse(res, false, "Erro interno do servidor");
      }

      if (row) {
        return sendResponse(res, false, "Mesa já está reservada neste horário");
      }

      // Inserir nova reserva
      db.run(
        "INSERT INTO reservas (data, hora, mesa, pessoas, responsavel, status) VALUES (?, ?, ?, ?, ?, 'reservada')",
        [data, hora, mesa, pessoas, responsavel],
        function(err) {
          if (err) {
            return sendResponse(res, false, "Erro ao criar reserva");
          }

          sendResponse(res, true, "Reserva criada com sucesso", {
            id: this.lastID,
            data, hora, mesa, pessoas, responsavel,
            status: 'reservada'
          });
        }
      );
    }
  );
});

// DELETE /api/reservas/:id - Cancelar reserva
app.delete('/api/reservas/:id', (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM reservas WHERE id = ?", [id], (err, row) => {
    if (err) {
      return sendResponse(res, false, "Erro interno do servidor");
    }

    if (!row) {
      return sendResponse(res, false, "Reserva não encontrada");
    }

    if (row.status === 'cancelada') {
      return sendResponse(res, false, "Reserva já foi cancelada");
    }

    db.run(
      "UPDATE reservas SET status = 'cancelada' WHERE id = ?",
      [id],
      function(err) {
        if (err) {
          return sendResponse(res, false, "Erro ao cancelar reserva");
        }

        sendResponse(res, true, "Reserva cancelada com sucesso");
      }
    );
  });
});

// PUT /api/reservas/:id/confirm - Confirmar reserva
app.put('/api/reservas/:id/confirm', (req, res) => {
  const { id } = req.params;
  const { garcom_id } = req.body;

  if (!garcom_id) {
    return sendResponse(res, false, "ID do garçom é obrigatório");
  }

  db.get("SELECT * FROM reservas WHERE id = ?", [id], (err, reserva) => {
    if (err) {
      return sendResponse(res, false, "Erro interno do servidor");
    }

    if (!reserva) {
      return sendResponse(res, false, "Reserva não encontrada");
    }

    if (reserva.status === 'cancelada') {
      return sendResponse(res, false, "Não é possível confirmar reserva cancelada");
    }

    if (reserva.status === 'confirmada') {
      return sendResponse(res, false, "Reserva já foi confirmada");
    }

    // Verificar se garçom existe
    db.get("SELECT * FROM garcons WHERE id = ?", [garcom_id], (err, garcom) => {
      if (err) {
        return sendResponse(res, false, "Erro interno do servidor");
      }

      if (!garcom) {
        return sendResponse(res, false, "Garçom não encontrado");
      }

      // Atualizar status da reserva
      db.run(
        "UPDATE reservas SET status = 'confirmada' WHERE id = ?",
        [id],
        function(err) {
          if (err) {
            return sendResponse(res, false, "Erro ao confirmar reserva");
          }

          // Inserir confirmação
          db.run(
            "INSERT INTO confirmacoes (reserva_id, garcom_id) VALUES (?, ?)",
            [id, garcom_id],
            function(err) {
              if (err) {
                return sendResponse(res, false, "Erro ao registrar confirmação");
              }

              sendResponse(res, true, "Reserva confirmada com sucesso", {
                reserva_id: id,
                garcom: garcom.nome
              });
            }
          );
        }
      );
    });
  });
});

// GET /api/relatorios/periodo - Relatório por período
app.get('/api/relatorios/periodo', (req, res) => {
  const { inicio, fim } = req.query;

  if (!inicio || !fim) {
    return sendResponse(res, false, "Parâmetros 'inicio' e 'fim' são obrigatórios");
  }

  db.all(
    `SELECT r.*, g.nome as garcom_nome 
     FROM reservas r 
     LEFT JOIN confirmacoes c ON r.id = c.reserva_id 
     LEFT JOIN garcons g ON c.garcom_id = g.id 
     WHERE r.data BETWEEN ? AND ? 
     ORDER BY r.data, r.hora`,
    [inicio, fim],
    (err, rows) => {
      if (err) {
        return sendResponse(res, false, "Erro ao gerar relatório");
      }

      const resumo = {
        total: rows.length,
        reservadas: rows.filter(r => r.status === 'reservada').length,
        confirmadas: rows.filter(r => r.status === 'confirmada').length,
        canceladas: rows.filter(r => r.status === 'cancelada').length
      };

      sendResponse(res, true, "Relatório gerado com sucesso", {
        periodo: { inicio, fim },
        resumo,
        reservas: rows
      });
    }
  );
});

// GET /api/relatorios/mesa/:mesa - Relatório por mesa
app.get('/api/relatorios/mesa/:mesa', (req, res) => {
  const { mesa } = req.params;

  db.all(
    `SELECT r.*, g.nome as garcom_nome 
     FROM reservas r 
     LEFT JOIN confirmacoes c ON r.id = c.reserva_id 
     LEFT JOIN garcons g ON c.garcom_id = g.id 
     WHERE r.mesa = ? 
     ORDER BY r.data DESC, r.hora DESC`,
    [mesa],
    (err, rows) => {
      if (err) {
        return sendResponse(res, false, "Erro ao gerar relatório");
      }

      sendResponse(res, true, "Relatório da mesa gerado com sucesso", {
        mesa: parseInt(mesa),
        total_reservas: rows.length,
        reservas: rows
      });
    }
  );
});

// GET /api/relatorios/garcom/:id - Relatório por garçom
app.get('/api/relatorios/garcom/:id', (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM garcons WHERE id = ?", [id], (err, garcom) => {
    if (err) {
      return sendResponse(res, false, "Erro interno do servidor");
    }

    if (!garcom) {
      return sendResponse(res, false, "Garçom não encontrado");
    }

    db.all(
      `SELECT r.* 
       FROM reservas r 
       INNER JOIN confirmacoes c ON r.id = c.reserva_id 
       WHERE c.garcom_id = ? 
       ORDER BY r.data DESC, r.hora DESC`,
      [id],
      (err, rows) => {
        if (err) {
          return sendResponse(res, false, "Erro ao gerar relatório");
        }

        sendResponse(res, true, "Relatório do garçom gerado com sucesso", {
          garcom: garcom.nome,
          total_confirmacoes: rows.length,
          reservas_confirmadas: rows
        });
      }
    );
  });
});

// GET /api/garcons - Listar garçons
app.get('/api/garcons', (req, res) => {
  db.all("SELECT * FROM garcons ORDER BY nome", (err, rows) => {
    if (err) {
      return sendResponse(res, false, "Erro ao buscar garçons");
    }

    sendResponse(res, true, "Garçons encontrados", rows);
  });
});

// GET /api/reservas - Listar todas as reservas
app.get('/api/reservas', (req, res) => {
  db.all(
    `SELECT r.*, g.nome as garcom_nome 
     FROM reservas r 
     LEFT JOIN confirmacoes c ON r.id = c.reserva_id 
     LEFT JOIN garcons g ON c.garcom_id = g.id 
     ORDER BY r.data DESC, r.hora DESC`,
    (err, rows) => {
      if (err) {
        return sendResponse(res, false, "Erro ao buscar reservas");
      }

      sendResponse(res, true, "Reservas encontradas", rows);
    }
  );
});

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});

// Fechar banco de dados quando aplicação terminar
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Banco de dados fechado.');
    process.exit(0);
  });
});
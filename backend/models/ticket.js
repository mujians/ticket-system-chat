const { pool } = require('./database');
const { v4: uuidv4 } = require('uuid');

class Ticket {
  static async create({ user_id, user_email, user_phone, question, priority = 'medium', category = 'general', metadata = {} }) {
    try {
      const result = await pool.query(
        `INSERT INTO tickets (user_id, user_email, user_phone, question, priority, category, metadata) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [user_id, user_email, user_phone, question, priority, category, JSON.stringify(metadata)]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Errore creazione ticket:', err);
      throw err;
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query('SELECT * FROM tickets WHERE id = $1', [id]);
      return result.rows[0];
    } catch (err) {
      console.error('Errore ricerca ticket:', err);
      throw err;
    }
  }

  static async findAll({ status, limit = 50, offset = 0, orderBy = 'created_at', order = 'DESC' }) {
    try {
      let query = `
        SELECT *, 
               EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as hours_old
        FROM tickets
      `;
      const params = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ` ORDER BY ${orderBy} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      
      // Get total count
      const countQuery = status ? 
        'SELECT COUNT(*) FROM tickets WHERE status = $1' :
        'SELECT COUNT(*) FROM tickets';
      const countParams = status ? [status] : [];
      const countResult = await pool.query(countQuery, countParams);
      
      return {
        tickets: result.rows,
        total: parseInt(countResult.rows[0].count),
        hasMore: offset + limit < parseInt(countResult.rows[0].count)
      };
    } catch (err) {
      console.error('Errore ricerca tickets:', err);
      throw err;
    }
  }

  static async updateResponse(id, response, adminId = 'system') {
    try {
      const result = await pool.query(
        `UPDATE tickets 
         SET response = $1, 
             status = 'resolved', 
             responded_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             metadata = metadata || $3
         WHERE id = $2 
         RETURNING *`,
        [response, id, JSON.stringify({ responded_by: adminId })]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Errore aggiornamento ticket:', err);
      throw err;
    }
  }

  static async updateStatus(id, status) {
    try {
      const result = await pool.query(
        `UPDATE tickets 
         SET status = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING *`,
        [status, id]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Errore aggiornamento status:', err);
      throw err;
    }
  }

  static async getStats() {
    try {
      const result = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today,
          AVG(EXTRACT(EPOCH FROM (responded_at - created_at))/3600) FILTER (WHERE responded_at IS NOT NULL) as avg_response_time_hours
        FROM tickets
      `);
      return result.rows[0];
    } catch (err) {
      console.error('Errore statistiche:', err);
      throw err;
    }
  }

  static async delete(id) {
    try {
      const result = await pool.query('DELETE FROM tickets WHERE id = $1 RETURNING *', [id]);
      return result.rows[0];
    } catch (err) {
      console.error('Errore eliminazione ticket:', err);
      throw err;
    }
  }
}

module.exports = Ticket;